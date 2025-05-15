'use strict';

const moment = require('moment');
const TuningSubscriptionModel = require('../models/tuning.subscription.model');
const { CODES } = require('../../core/controllers/httpcodes.server.controller');

class SubscriptionMiddleware {
  static async checkTuningSessionLimit(req, res, next) {
    try {
      const userId = req.user.userId;

      // Get user's active subscription
      const subscription = await TuningSubscriptionModel.getActiveSubscription(userId);

      if (!subscription) {
        return res.status(CODES.FORBIDDEN).json({
          custom_error_code: 'INSUFFICIENT_CREDITS',
          message: req.t('generator:NO_ACTIVE_SUBSCRIPTION')
        });
      }

      // Get subscription plan details
      const subscriptionPlan = await TuningSubscriptionModel.getSubscriptionPlan(
        subscription.provider_plan_id,
        subscription.provider
      );

      if (!subscriptionPlan || !subscriptionPlan.additional_data) {
        return res.status(CODES.FORBIDDEN).json({
          message: req.t('generator:NO_ACTIVE_SUBSCRIPTION')
        });
      }

      // Parse additional_data to get session limit
      const sessionLimit = subscriptionPlan.additional_data?.character_training_allowed?.sessions_per_month || 0;

      // Check if subscription is within current period
      const now = moment().utc();
      const periodStart = moment(subscription.current_period_start).utc();
      const periodEnd = moment(subscription.current_period_end).utc();
      
      if (!periodStart.isValid() || !periodEnd.isValid() || now.isBefore(periodStart) || now.isAfter(periodEnd)) {
        return res.status(CODES.FORBIDDEN).json({
          message: req.t('generator:NO_ACTIVE_SUBSCRIPTION')
        });
      }

      // Get current period's session count
      const currentCount = await TuningSubscriptionModel.getMonthlyTuningSessionCount(
        userId,
        periodStart.format('YYYY-MM-DD HH:mm:ss')
      );

      if (currentCount >= sessionLimit) {
        return res.status(CODES.RATE_LIMITED).json({
          message: req.t('generator:TUNING_SESSION_LIMIT_EXCEEDED', { limit: sessionLimit })
        });
      }

      // Add subscription data to request for downstream use
      req.subscription = {
        plan: subscriptionPlan,
        subscription: subscription,
        sessionLimit: sessionLimit,
        currentCount: currentCount
      };

      next();
    } catch (error) {
      console.error('Error checking tuning session limit:', error);
      return res.status(CODES.INTERNAL_SERVER_ERROR).json({
        message: req.t('generator:TUNING_SUBSCRIPTION_ERROR')
      });
    }
  }
}

module.exports = SubscriptionMiddleware; 
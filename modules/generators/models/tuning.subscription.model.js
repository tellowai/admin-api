'use strict';

const MysqlQueryRunner = require('../../core/models/mysql.promise.model');
const {
  runQueryInMaster: RunCHQueryInMaster,
  runQueryingInSlave: RunCHQueryingInSlave
} = require('../../core/models/clickhouse.promise.model');

class TuningSubscriptionModel {
  static async getActiveSubscription(userId) {
    const query = `
      SELECT 
        subscription_id,
        user_id,
        provider,
        currency,
        provider_subscription_id,
        provider_plan_id,
        status,
        total_count,
        start_at,
        end_at,
        renews_at,
        current_period_start,
        current_period_end,
        additional_data
      FROM subscriptions
      WHERE user_id = ?
      AND status IN ('active', 'active_non_recurring', 'trial')
      AND (end_at IS NULL OR end_at > NOW())
      AND (cancelled_at IS NULL)
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await MysqlQueryRunner.runQueryInSlave(query, [userId]);
    return result[0];
  }

  static async getSubscriptionPlan(providerPlanId, provider) {
    const query = `
      SELECT 
        subscription_plan_id,
        subscription_type,
        subscription_name,
        price,
        currency,
        billing_interval,
        benefits,
        description,
        provider,
        provider_plan_id,
        credits,
        bonus_credits,
        discount_percentage,
        social_proof,
        additional_data,
        order_index
      FROM subscription_plans
      WHERE provider_plan_id = ?
      AND provider = ?
      AND archived_at IS NULL
      LIMIT 1
    `;

    const result = await MysqlQueryRunner.runQueryInSlave(query, [providerPlanId, provider]);
    return result[0];
  }

  static async getMonthlyTuningSessionCount(userId, startDate) {
    const query = `
      SELECT COUNT(*) as count 
      FROM tuning_session_events 
      WHERE user_id = '${userId}'
      AND event_type = 'SUBMITTED'
      AND event_time >= '${startDate}'
    `;

    const result = await RunCHQueryingInSlave(query);
    return result[0]?.count || 0;
  }
}

module.exports = TuningSubscriptionModel; 
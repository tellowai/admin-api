'use strict';

const Joi = require('@hapi/joi');
const validationCtrl = require('../../core/controllers/validation.controller');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const { ALL_SUBSCRIPTION_EVENT_TYPE_FILTER_VALUES } = require('../constants/subscription-event-types');

const ordersAnalyticsQuerySchema = Joi.object({
  start_date: Joi.alternatives().try(Joi.date(), Joi.string()).required(),
  end_date: Joi.alternatives().try(Joi.date(), Joi.string()).required(),
  tz: Joi.string().optional().allow(''),
  product_type: Joi.string().valid('', 'alacarte', 'subscription', 'onetime', 'addon').optional().allow(''),
  payment_gateway: Joi.string()
    .valid(
      '',
      'razorpay',
      'dodopayments',
      'google_play',
      'apple_iap',
      'revenuecat',
      'stripe',
      'apple'
    )
    .optional()
    .allow('')
});

/** Paginated subscription rows for Purchases analytics (same date/tz semantics as other order analytics). */
const userSubscriptionsTableQuerySchema = Joi.object({
  start_date: Joi.alternatives().try(Joi.date(), Joi.string()).required(),
  end_date: Joi.alternatives().try(Joi.date(), Joi.string()).required(),
  tz: Joi.string().optional().allow(''),
  client_platform: Joi.string().valid('', 'ios', 'android', 'web').optional().allow(''),
  payment_plan_id: Joi.string().optional().allow('').pattern(/^\d*$/),
  subscription_event_type: Joi.string()
    .valid(...ALL_SUBSCRIPTION_EVENT_TYPE_FILTER_VALUES)
    .optional()
    .allow(''),
  subscription_status: Joi.string().trim().lowercase().max(64).optional().allow(''),
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(25)
});

exports.validateOrdersAnalyticsQuery = function (req, res, next) {
  const payloadValidation = validationCtrl.validate(ordersAnalyticsQuerySchema, req.query);
  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }
  req.validatedQuery = payloadValidation.value;
  return next(null);
};

exports.validateUserSubscriptionsTableQuery = function (req, res, next) {
  const payloadValidation = validationCtrl.validate(userSubscriptionsTableQuerySchema, req.query);
  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }
  req.validatedQuery = payloadValidation.value;
  return next(null);
};

/** Paginated customers with at least one purchase (lifetime). */
const purchasingCustomersTableQuerySchema = Joi.object({
  search: Joi.string().trim().max(128).optional().allow(''),
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  sort: Joi.string()
    .valid(
      'last_purchased_at',
      'alacarte_purchases',
      'subscription_purchases',
      'addon_purchases',
      'total_purchases'
    )
    .optional()
    .default('last_purchased_at'),
  sort_dir: Joi.string().valid('asc', 'desc').optional().default('desc')
});

exports.validatePurchasingCustomersTableQuery = function (req, res, next) {
  const payloadValidation = validationCtrl.validate(purchasingCustomersTableQuerySchema, req.query);
  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }
  req.validatedQuery = payloadValidation.value;
  return next(null);
};

'use strict';

const Joi = require('@hapi/joi');

const dateRangeSchema = Joi.object().keys({
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().min(Joi.ref('start_date')).required(),
  start_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  end_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  tz: Joi.string().optional()
});

const characterAnalyticsSchema = Joi.object().keys({
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().min(Joi.ref('start_date')).required(),
  start_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  end_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  gender: Joi.string().valid('male', 'female', 'couple', 'unknown').optional(),
  character_id: Joi.string().optional(),
  user_id: Joi.string().optional(),
  group_by: Joi.string().valid('gender').optional(),
  tz: Joi.string().optional()
});

const templateAnalyticsSchema = Joi.object().keys({
  start_date: Joi.date().required(),
  end_date: Joi.date().min(Joi.ref('start_date')).required(),
  start_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  end_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  output_type: Joi.string().valid('image', 'video', 'audio', 'pdf', 'website', 'unknown').optional(),
  aspect_ratio: Joi.string().valid('9:16', '16:9', '3:4', '4:3', '1:1', 'unknown').optional(),
  orientation: Joi.string().valid('horizontal', 'vertical', 'unknown').optional(),
  generation_type: Joi.string().valid('ai', 'non-ai', 'unknown').optional(),
  template_id: Joi.string().optional(),
  user_id: Joi.string().optional(),
  group_by: Joi.string().valid('output_type', 'aspect_ratio', 'orientation', 'generation_type').optional(),
  tz: Joi.string().optional()
});

const templateTopByGenerationSchema = Joi.object().keys({
  start_date: Joi.date().required(),
  end_date: Joi.date().min(Joi.ref('start_date')).required(),
  tz: Joi.string().optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional()
});

const signupAnalyticsSchema = Joi.object().keys({
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().min(Joi.ref('start_date')).required(),
  start_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  end_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  provider: Joi.string().valid('google', 'facebook', 'truecaller', 'otp', 'otp_mobile', 'otp_email', 'unknown').optional(),
  user_id: Joi.string().optional(),
  group_by: Joi.string().valid('provider').optional(),
  tz: Joi.string().optional()
});

const loginAnalyticsSchema = Joi.object().keys({
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().min(Joi.ref('start_date')).required(),
  start_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  end_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  provider: Joi.string().valid('google', 'facebook', 'truecaller', 'otp', 'otp_mobile', 'otp_email', 'unknown').optional(),
  user_id: Joi.string().optional(),
  group_by: Joi.string().valid('provider').optional(),
  tz: Joi.string().optional()
});

const purchasesAnalyticsSchema = Joi.object().keys({
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().min(Joi.ref('start_date')).required(),
  start_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  end_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  plan_id: Joi.string().optional(),
  plan_name: Joi.string().optional(),
  plan_type: Joi.string().valid('subscription', 'one-time', 'unknown').optional(),
  payment_provider: Joi.string().valid('razorpay', 'stripe', 'paypal', 'google_pay', 'apple_pay', 'upi', 'card', 'net_banking', 'wallet', 'unknown').optional(),
  currency: Joi.string().valid('INR', 'USD', 'unknown').optional(),
  user_id: Joi.string().optional(),
  group_by: Joi.string().valid('currency', 'payment_provider', 'plan_name').optional(),
  tz: Joi.string().optional()
});

const creditsAnalyticsSchema = Joi.object().keys({
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().min(Joi.ref('start_date')).required(),
  start_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  end_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  reason: Joi.string().optional(),
  country: Joi.string().optional(),
  group_by: Joi.string().valid('reason', 'country').optional(),
  tz: Joi.string().optional()
});

const pipelineAnalyticsSchema = Joi.object().keys({
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().min(Joi.ref('start_date')).required(),
  template_id: Joi.string().optional(),
  provider_name: Joi.string().optional(),
  model_name: Joi.string().optional(),
  ae_version: Joi.string().optional(),
  tz: Joi.string().optional()
});

const techHealthAnalyticsSchema = Joi.object().keys({
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().min(Joi.ref('start_date')).required(),
  tz: Joi.string().optional(),
  limit: Joi.number().integer().min(1).max(100).optional()
});

/**
 * payment_failures_daily_stats filters.
 * All filter columns are LowCardinality(String) on the MV — keep Joi lenient
 * (plain strings) so new enum values added to payment.failure.constants.js
 * don't require an admin-api deploy.
 */
const ALLOWED_PAYMENT_FAILURES_GROUP_BYS = [
  'failure_layer',
  'failure_category',
  'payment_gateway',
  'error_code',
  'retryable',
  'product_classification',
  'plan_type',
  'billing_interval',
  'currency',
  'store_country',
  'ip_country',
  'app_version',
  'os_name',
  'event_name'
];

const paymentFailuresAnalyticsSchema = Joi.object().keys({
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().min(Joi.ref('start_date')).required(),
  tz: Joi.string().optional().allow(''),

  event_name: Joi.string().optional().allow(''),
  failure_layer: Joi.string().optional().allow(''),
  failure_category: Joi.string().optional().allow(''),
  payment_gateway: Joi.string().optional().allow(''),
  error_code: Joi.string().optional().allow(''),
  retryable: Joi.string().valid('', 'true', 'false').optional(),
  product_classification: Joi.string().optional().allow(''),
  plan_type: Joi.string().optional().allow(''),
  billing_interval: Joi.string().optional().allow(''),
  currency: Joi.string().optional().allow(''),
  store_country: Joi.string().optional().allow(''),
  ip_country: Joi.string().optional().allow(''),
  app_version: Joi.string().optional().allow(''),
  os_name: Joi.string().optional().allow(''),
  timezone: Joi.string().optional().allow(''),

  group_by: Joi.string().valid(...ALLOWED_PAYMENT_FAILURES_GROUP_BYS).optional(),
  row_by: Joi.string().valid(...ALLOWED_PAYMENT_FAILURES_GROUP_BYS).optional(),
  col_by: Joi.string().valid(...ALLOWED_PAYMENT_FAILURES_GROUP_BYS).optional(),
  limit: Joi.number().integer().min(1).max(500).optional(),

  // Raw-event drill-downs (`/samples`, `/message-groups`).
  // `offset` paginates samples; `search` is a substring match on
  // `properties['error_message']` for narrowing into specific unknowns.
  offset: Joi.number().integer().min(0).max(5000).optional(),
  search: Joi.string().max(120).optional().allow('')
});

exports.dateRangeSchema = dateRangeSchema;
exports.characterAnalyticsSchema = characterAnalyticsSchema;
exports.templateAnalyticsSchema = templateAnalyticsSchema;
exports.templateTopByGenerationSchema = templateTopByGenerationSchema;
exports.signupAnalyticsSchema = signupAnalyticsSchema;
exports.loginAnalyticsSchema = loginAnalyticsSchema;
exports.purchasesAnalyticsSchema = purchasesAnalyticsSchema;
exports.creditsAnalyticsSchema = creditsAnalyticsSchema;
exports.pipelineAnalyticsSchema = pipelineAnalyticsSchema;
exports.techHealthAnalyticsSchema = techHealthAnalyticsSchema;
exports.paymentFailuresAnalyticsSchema = paymentFailuresAnalyticsSchema;

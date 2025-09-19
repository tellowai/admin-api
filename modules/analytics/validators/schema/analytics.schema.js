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
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().min(Joi.ref('start_date')).required(),
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

exports.dateRangeSchema = dateRangeSchema;
exports.characterAnalyticsSchema = characterAnalyticsSchema;
exports.templateAnalyticsSchema = templateAnalyticsSchema;
exports.signupAnalyticsSchema = signupAnalyticsSchema;
exports.loginAnalyticsSchema = loginAnalyticsSchema;
exports.purchasesAnalyticsSchema = purchasesAnalyticsSchema;

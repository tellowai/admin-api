'use strict';

const Joi = require('@hapi/joi');

const gatewaySchema = Joi.object().keys({
  payment_gateway: Joi.string().required(),
  pg_plan_id: Joi.string().required(),
  is_active: Joi.number().integer().valid(0, 1).optional()
});

const uiConfigSchema = Joi.object().keys({
  self_selection_text: Joi.string().allow('').optional(),
  panel_bg_color: Joi.string().allow('').optional(),
  panel_glow_color: Joi.string().allow('').optional(),
  panel_border_color: Joi.string().allow('').optional(),
  button_cta_text: Joi.string().allow('').optional(),
  button_bg_color: Joi.string().allow('').optional(),
  button_text_color: Joi.string().allow('').optional(),
  plan_badge: Joi.string().allow('').optional(),
  plan_badge_bg_color: Joi.string().allow('').optional(),
  plan_badge_border_color: Joi.string().allow('').optional(),
  plan_badge_text_color: Joi.string().allow('').optional(),
  plan_badge_icon: Joi.string().allow('').optional()
});

const createPaymentPlanSchema = Joi.object().keys({
  plan_name: Joi.string().required(),
  tier: Joi.string().valid('premium', 'ai', 'unified').required(),
  plan_type: Joi.string().valid('single', 'bundle', 'credits').required(),
  plan_heading: Joi.string().allow('').optional(),
  plan_subheading: Joi.string().allow('').optional(),
  plan_benefits: Joi.array().items(Joi.string()).optional(),
  original_price: Joi.number().min(0).optional(),
  current_price: Joi.number().min(0).required(),
  currency: Joi.string().required(),
  billing_interval: Joi.string().required(),
  template_count: Joi.number().integer().min(0).allow(null).optional(),
  max_creations_per_template: Joi.number().integer().min(1).optional(),
  credits: Joi.number().integer().min(0).allow(null).optional(),
  bonus_credits: Joi.number().integer().min(0).optional(),
  validity_days: Joi.number().integer().min(1).required(),
  is_active: Joi.number().integer().valid(0, 1).optional(),
  gateways: Joi.array().items(gatewaySchema).optional(),
  ui_config: uiConfigSchema.optional()
});

const updatePaymentPlanSchema = Joi.object().keys({
  plan_name: Joi.string().optional(),
  tier: Joi.string().valid('premium', 'ai', 'unified').optional(),
  plan_type: Joi.string().valid('single', 'bundle', 'credits').optional(),
  plan_heading: Joi.string().allow('').optional(),
  plan_subheading: Joi.string().allow('').optional(),
  plan_benefits: Joi.array().items(Joi.string()).optional(),
  original_price: Joi.number().min(0).optional(),
  current_price: Joi.number().min(0).optional(),
  currency: Joi.string().optional(),
  billing_interval: Joi.string().optional(),
  template_count: Joi.number().integer().min(0).allow(null).optional(),
  max_creations_per_template: Joi.number().integer().min(1).optional(),
  credits: Joi.number().integer().min(0).allow(null).optional(),
  bonus_credits: Joi.number().integer().min(0).optional(),
  validity_days: Joi.number().integer().min(1).optional(),
  gateways: Joi.array().items(gatewaySchema).optional(),
  ui_config: uiConfigSchema.optional()
  // is_active excluded from update as per previous requirement
});

exports.createPaymentPlanSchema = createPaymentPlanSchema;
exports.updatePaymentPlanSchema = updatePaymentPlanSchema;

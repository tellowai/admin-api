'use strict';

const Joi = require('@hapi/joi');

/** Must match modules/templates/validators/schema/template.schema.js — 9, 19, …, 999 */
const ALACARTE_INR_PRICE_TIERS = Array.from({ length: 100 }, (_, i) => 9 + i * 10);

const HEX_COLOR = Joi.string()
  .max(16)
  .allow(null, '')
  .pattern(/^#([0-9A-Fa-f]{6})$/)
  .messages({ 'string.pattern.base': 'Must be a hex color like #D4A574' });

const EXPLORE_SEE_ALL_CTA_STYLES = ['gold_gradient', 'gold_flat', 'silver_gradient', 'silver_flat'];

const createPackSchema = Joi.object().keys({
  pack_name: Joi.string().max(255).required(),
  description: Joi.string().max(20000).allow(null, ''),
  featured_badge_title: Joi.string().max(160).allow(null, ''),
  featured_badge_icon: Joi.string().max(128).allow(null, ''),
  featured_badge_color: HEX_COLOR,
  explore_see_all_cta_style: Joi.string().valid(...EXPLORE_SEE_ALL_CTA_STYLES).optional(),
  thumbnail_cf_r2_key: Joi.string().max(512).allow(null),
  thumbnail_cf_r2_url: Joi.string().max(1000).uri().allow(null),
  additional_data: Joi.object().allow(null),
  language_code: Joi.string().max(10).allow(null).optional(),
  people_used_count: Joi.number().integer().min(0).max(9999999).allow(null).optional()
});

const updatePackSchema = Joi.object().keys({
  pack_name: Joi.string().max(255),
  description: Joi.string().max(20000).allow(null, ''),
  featured_badge_title: Joi.string().max(160).allow(null, ''),
  featured_badge_icon: Joi.string().max(128).allow(null, ''),
  featured_badge_color: HEX_COLOR,
  explore_see_all_cta_style: Joi.string().valid(...EXPLORE_SEE_ALL_CTA_STYLES).optional(),
  thumbnail_cf_r2_key: Joi.string().max(512).allow(null),
  thumbnail_cf_r2_url: Joi.string().max(1000).uri().allow(null),
  additional_data: Joi.object().allow(null),
  language_code: Joi.string().max(10).allow(null).optional(),
  credits: Joi.number().integer().min(1).optional(),
  alacarte_price: Joi.number().integer().valid(...ALACARTE_INR_PRICE_TIERS).allow(null).optional(),
  /** Compare-at list price for pack storefront (strike-through); not payment tiers — may differ from template sums. */
  alacarte_original_price: Joi.number().integer().positive().max(9999999).allow(null).optional(),
  people_used_count: Joi.number().integer().min(0).max(9999999).allow(null).optional()
});

const addTemplatesSchema = Joi.object().keys({
  templates: Joi.array().items(
    Joi.object({
      template_id: Joi.string().uuid().required(),
      sort_order: Joi.number().integer().min(0)
    })
  ).required()
});

const removeTemplatesSchema = Joi.object().keys({
  template_ids: Joi.array().items(
    Joi.string().uuid().required()
  ).required()
});

exports.createPackSchema = createPackSchema;
exports.updatePackSchema = updatePackSchema;
exports.addTemplatesSchema = addTemplatesSchema;
exports.removeTemplatesSchema = removeTemplatesSchema; 
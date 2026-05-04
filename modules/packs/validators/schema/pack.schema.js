'use strict';

const Joi = require('@hapi/joi');

const createPackSchema = Joi.object().keys({
  pack_name: Joi.string().max(255).required(),
  thumbnail_cf_r2_key: Joi.string().max(512).allow(null),
  thumbnail_cf_r2_url: Joi.string().max(1000).uri().allow(null),
  additional_data: Joi.object().allow(null),
  language_code: Joi.string().max(10).allow(null).optional()
});

const updatePackSchema = Joi.object().keys({
  pack_name: Joi.string().max(255),
  thumbnail_cf_r2_key: Joi.string().max(512).allow(null),
  thumbnail_cf_r2_url: Joi.string().max(1000).uri().allow(null),
  additional_data: Joi.object().allow(null),
  language_code: Joi.string().max(10).allow(null).optional()
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
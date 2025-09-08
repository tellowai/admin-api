'use strict';

const Joi = require('@hapi/joi');

const createCollectionSchema = Joi.object().keys({
  collection_name: Joi.string().max(255).required(),
  thumbnail_cf_r2_key: Joi.string().max(512).allow(null),
  thumbnail_cf_r2_url: Joi.string().max(1000).allow(null),
  additional_data: Joi.object().allow(null),
  is_manual: Joi.boolean().optional(),
  rule_json: Joi.object().allow(null).optional(),
  is_materialized: Joi.boolean().optional()
});

const updateCollectionSchema = Joi.object().keys({
  collection_name: Joi.string().max(255).optional(),
  thumbnail_cf_r2_key: Joi.string().max(512).allow(null).optional(),
  thumbnail_cf_r2_url: Joi.string().max(1000).allow(null).optional(),
  additional_data: Joi.object().allow(null).optional(),
  is_manual: Joi.boolean().optional(),
  rule_json: Joi.object().allow(null).optional(),
  is_materialized: Joi.boolean().optional()
});

const addTemplatesSchema = Joi.object().keys({
  template_ids: Joi.array().items(Joi.string().uuid()).min(1).required()
});

const addTemplatesToCollectionsSchema = Joi.object().keys({
  template_ids: Joi.array().items(Joi.string().uuid()).min(1).required(),
  collection_ids: Joi.array().items(Joi.number().integer().positive()).min(1).required()
});

const removeTemplatesSchema = Joi.object().keys({
  template_ids: Joi.array().items(Joi.string().uuid()).min(1).required()
});

exports.createCollectionSchema = createCollectionSchema;
exports.updateCollectionSchema = updateCollectionSchema;
exports.addTemplatesSchema = addTemplatesSchema;
exports.addTemplatesToCollectionsSchema = addTemplatesToCollectionsSchema;
exports.removeTemplatesSchema = removeTemplatesSchema; 
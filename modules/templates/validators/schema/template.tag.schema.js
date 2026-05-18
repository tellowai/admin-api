'use strict';

const Joi = require('@hapi/joi');

const tagAdditionalDataSchema = Joi.object({
  palette_key: Joi.string().max(32).optional(),
  background: Joi.string().max(512).optional(),
  icon_color: Joi.string().max(128).optional(),
  text_color: Joi.string().max(128).optional(),
  subtext_color: Joi.string().max(128).optional(),
  subtext_backfill: Joi.string().max(80).optional(),
  icon: Joi.string().max(64).optional(),
  sort: Joi.number().integer().min(0).optional()
}).optional();

const createTemplateTagSchema = Joi.object().keys({
  tag_name: Joi.string().max(36).required(),
  tag_code: Joi.string().max(36).required(),
  tag_description: Joi.string().allow(null, '').optional(),
  facet_id: Joi.number().integer().positive().required(),
  is_active: Joi.boolean().optional(),
  additional_data: tagAdditionalDataSchema
});

const updateTemplateTagSchema = Joi.object().keys({
  tag_name: Joi.string().max(36).optional(),
  tag_code: Joi.string().max(36).optional(),
  tag_description: Joi.string().allow(null, '').optional(),
  facet_id: Joi.number().integer().positive().optional(),
  is_active: Joi.boolean().optional(),
  additional_data: tagAdditionalDataSchema
});

const bulkArchiveTemplateTagsSchema = Joi.object().keys({
  tag_ids: Joi.array().items(Joi.string().required()).min(1).max(50).required()
});

const bulkUnarchiveTemplateTagsSchema = Joi.object().keys({
  tag_ids: Joi.array().items(Joi.string().required()).min(1).max(50).required()
});

exports.createTemplateTagSchema = createTemplateTagSchema;
exports.updateTemplateTagSchema = updateTemplateTagSchema;
exports.bulkArchiveTemplateTagsSchema = bulkArchiveTemplateTagsSchema;
exports.bulkUnarchiveTemplateTagsSchema = bulkUnarchiveTemplateTagsSchema;

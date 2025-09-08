'use strict';

const Joi = require('@hapi/joi');

const createTemplateTagSchema = Joi.object().keys({
  tag_name: Joi.string().max(36).required(),
  tag_code: Joi.string().max(36).required(),
  tag_description: Joi.string().allow(null, '').optional(),
  facet_id: Joi.number().integer().positive().required(),
  is_active: Joi.boolean().optional()
});

const updateTemplateTagSchema = Joi.object().keys({
  tag_name: Joi.string().max(36).optional(),
  tag_code: Joi.string().max(36).optional(),
  tag_description: Joi.string().allow(null, '').optional(),
  facet_id: Joi.number().integer().positive().optional(),
  is_active: Joi.boolean().optional()
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

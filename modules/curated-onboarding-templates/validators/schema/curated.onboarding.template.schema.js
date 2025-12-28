'use strict';

const Joi = require('@hapi/joi');

const createCuratedOnboardingTemplateSchema = Joi.object().keys({
  template_id: Joi.string().uuid().required(),
  is_active: Joi.number().integer().valid(0, 1).default(1)
});

const updateCuratedOnboardingTemplateSchema = Joi.object().keys({
  template_id: Joi.string().uuid().optional(),
  is_active: Joi.number().integer().valid(0, 1).optional()
});

const bulkCreateCuratedOnboardingTemplatesSchema = Joi.object().keys({
  template_ids: Joi.array().items(Joi.string().uuid()).min(1).max(100).required(),
  is_active: Joi.number().integer().valid(0, 1).default(1)
});

const bulkArchiveCuratedOnboardingTemplatesSchema = Joi.object().keys({
  cot_ids: Joi.array().items(Joi.number().integer().positive()).min(1).max(100).required()
});

const bulkArchiveByTemplateIdsSchema = Joi.object().keys({
  template_ids: Joi.array().items(Joi.string().uuid()).min(1).max(100).required()
});

exports.createCuratedOnboardingTemplateSchema = createCuratedOnboardingTemplateSchema;
exports.updateCuratedOnboardingTemplateSchema = updateCuratedOnboardingTemplateSchema;
exports.bulkCreateCuratedOnboardingTemplatesSchema = bulkCreateCuratedOnboardingTemplatesSchema;
exports.bulkArchiveCuratedOnboardingTemplatesSchema = bulkArchiveCuratedOnboardingTemplatesSchema;
exports.bulkArchiveByTemplateIdsSchema = bulkArchiveByTemplateIdsSchema;


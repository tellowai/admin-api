'use strict';

const Joi = require('@hapi/joi');

const createLanguageSchema = Joi.object().keys({
  code: Joi.string().max(10).required(),
  name: Joi.string().max(100).required(),
  native_name: Joi.string().max(100).required(),
  is_app_language: Joi.boolean().optional(),
  is_content_language: Joi.boolean().optional(),
  direction: Joi.string().valid('ltr', 'rtl').optional(),
  background_style: Joi.string().max(512).allow(null, '').optional()
});

const updateLanguageSchema = Joi.object().keys({
  code: Joi.string().max(10).optional(),
  name: Joi.string().max(100).optional(),
  native_name: Joi.string().max(100).optional(),
  is_app_language: Joi.boolean().optional(),
  is_content_language: Joi.boolean().optional(),
  direction: Joi.string().valid('ltr', 'rtl').optional(),
  background_style: Joi.string().max(512).allow(null, '').optional()
}).min(1);

const updateLanguageStatusSchema = Joi.object().keys({
  status: Joi.string().valid('active', 'inactive', 'disabled').required()
});

exports.createLanguageSchema = createLanguageSchema;
exports.updateLanguageSchema = updateLanguageSchema;
exports.updateLanguageStatusSchema = updateLanguageStatusSchema;


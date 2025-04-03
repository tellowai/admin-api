'use strict';

const Joi = require('@hapi/joi');

const createTemplateSchema = Joi.object().keys({
  template_name: Joi.string().max(255).required(),
  template_code: Joi.string().max(9).required(),
  template_output_type: Joi.string().valid('image', 'video', 'audio').required(),
  template_gender: Joi.string().valid('male', 'female', 'unisex', 'couple').optional(),
  description: Joi.string().allow(null),
  prompt: Joi.string().required(),
  faces_needed: Joi.array().items(Joi.object().keys({
    character_name: Joi.string().required(),
    character_gender: Joi.string().valid('male', 'female', 'unisex', 'couple').required(),
    character_face_r2_url: Joi.string().optional(),
    character_face_r2_key: Joi.string().optional(),
    template_character_id: Joi.string().optional()
  })).allow(null),
  cf_r2_key: Joi.string().max(512).allow(null),
  cf_r2_url: Joi.string().max(1000).allow(null),
  credits: Joi.number().integer().min(1).default(1),
  additional_data: Joi.object().allow(null)
});

const updateTemplateSchema = Joi.object().keys({
  template_name: Joi.string().max(255).optional(),
  template_code: Joi.string().max(255).optional(),
  template_output_type: Joi.string().valid('image', 'video', 'audio').optional(),
  template_gender: Joi.string().valid('male', 'female', 'unisex', 'couple').optional(),
  description: Joi.string().allow(null).optional(),
  prompt: Joi.string().optional(),
  faces_needed: Joi.array().items(Joi.object().keys({
    character_name: Joi.string().optional(),
    character_gender: Joi.string().valid('male', 'female', 'unisex', 'couple').optional(),
    character_face_r2_url: Joi.string().optional(),
    character_face_r2_key: Joi.string().optional(),
    template_character_id: Joi.string().optional()
  })).allow(null),
  cf_r2_key: Joi.string().max(512).allow(null).optional(),
  cf_r2_url: Joi.string().max(1000).allow(null).optional(),
  credits: Joi.number().integer().min(1).optional(),
  additional_data: Joi.object().allow(null).optional()
});

exports.createTemplateSchema = createTemplateSchema;
exports.updateTemplateSchema = updateTemplateSchema; 
'use strict';

const Joi = require('@hapi/joi');

// Workflow step schema
const workflowStepSchema = Joi.object({
  workflow_id: Joi.string().required(),
  workflow_code: Joi.string().required(),
  order_index: Joi.number().integer().min(0).required(),
  data: Joi.array().items(
    Joi.object({
      type: Joi.string().required(),
      value: Joi.alternatives().try(Joi.string(), Joi.number(), Joi.object()).required()
    })
  ).optional()
});

// Clip schema for the new structure
const clipSchema = Joi.object({
  clip_index: Joi.number().integer().min(1).required(),
  asset_type: Joi.string().valid('image', 'video').default('video'),
  workflow: Joi.array().items(workflowStepSchema).required().min(1)
});

// Custom text input field schema
const customTextInputFieldSchema = Joi.object({
  layer_name: Joi.string().required(),
  user_input_field_name: Joi.string().required(),
  input_field_type: Joi.string().valid('text', 'long_text', 'date', 'datetime', 'time').required(),
  default_text: Joi.string().allow('', null).optional()
});

const createTemplateSchema = Joi.object().keys({
  template_name: Joi.string().max(255).required(),
  template_code: Joi.string().max(9).required(),
  template_output_type: Joi.string().valid('image', 'video', 'audio').required(),
  template_clips_assets_type: Joi.string().valid('ai', 'non-ai').required(),
  template_gender: Joi.string().valid('male', 'female', 'unisex', 'couple').optional(),
  description: Joi.string().allow(null, ''),
  prompt: Joi.string().allow('').when('template_output_type', {
    is: 'image',
    then: Joi.optional(),
    otherwise: Joi.optional()
  }),
  faces_needed: Joi.array().items(Joi.object().keys({
    character_name: Joi.string().required(),
    character_gender: Joi.string().valid('male', 'female', 'unisex', 'couple').required(),
    character_face_r2_url: Joi.string().optional(),
    character_face_r2_key: Joi.string().optional(),
    template_character_id: Joi.string().optional()
  })).allow(null),
  cf_r2_key: Joi.string().max(512).allow(null),
  cf_r2_bucket: Joi.string().max(512).allow(null),
  cf_r2_url: Joi.string().max(1000).allow(null),
  color_video_bucket: Joi.string().max(255).allow(null),
  color_video_key: Joi.string().max(512).allow(null),
  mask_video_bucket: Joi.string().max(255).allow(null),
  mask_video_key: Joi.string().max(512).allow(null),
  bodymovin_json_bucket: Joi.string().max(255).allow(null),
  bodymovin_json_key: Joi.string().max(512).allow(null),
  custom_text_input_fields: Joi.array().items(customTextInputFieldSchema).allow(null),
  user_assets_layer: Joi.string().valid('top', 'bottom').default('bottom'),
  credits: Joi.number().integer().min(1).default(1),
  additional_data: Joi.object().allow(null),
  // Clips are required for 'ai' templates and must be empty for 'non-ai'
  clips: Joi.array()
    .items(clipSchema)
    .when('template_clips_assets_type', {
      is: 'ai',
      then: Joi.array().items(clipSchema).min(1).required(),
      otherwise: Joi.array().items(clipSchema).max(0).optional()
    })
});

const updateTemplateSchema = Joi.object().keys({
  template_name: Joi.string().max(255).optional(),
  template_code: Joi.string().max(255).optional(),
  template_output_type: Joi.string().valid('image', 'video', 'audio').optional(),
  template_clips_assets_type: Joi.string().valid('ai', 'non-ai').optional(),
  template_gender: Joi.string().valid('male', 'female', 'unisex', 'couple').optional(),
  description: Joi.string().allow(null, '').optional(),
  prompt: Joi.string().allow('').optional(),
  faces_needed: Joi.array().items(Joi.object().keys({
    character_name: Joi.string().optional(),
    character_gender: Joi.string().valid('male', 'female', 'unisex', 'couple').optional(),
    character_face_r2_url: Joi.string().optional(),
    character_face_r2_key: Joi.string().optional(),
    template_character_id: Joi.string().optional()
  })).allow(null),
  cf_r2_key: Joi.string().max(512).allow(null).optional(),
  cf_r2_url: Joi.string().max(1000).allow(null).optional(),
  color_video_bucket: Joi.string().max(255).allow(null).optional(),
  color_video_key: Joi.string().max(512).allow(null).optional(),
  mask_video_bucket: Joi.string().max(255).allow(null).optional(),
  mask_video_key: Joi.string().max(512).allow(null).optional(),
  bodymovin_json_bucket: Joi.string().max(255).allow(null).optional(),
  bodymovin_json_key: Joi.string().max(512).allow(null).optional(),
  custom_text_input_fields: Joi.array().items(customTextInputFieldSchema).allow(null).optional(),
  user_assets_layer: Joi.string().valid('top', 'bottom').optional(),
  credits: Joi.number().integer().min(1).optional(),
  additional_data: Joi.object().allow(null).optional(),
  clips: Joi.array().items(clipSchema).optional()
});

const bulkArchiveTemplatesSchema = Joi.object().keys({
  template_ids: Joi.array().items(Joi.string().required()).min(1).max(50).required()
});

exports.createTemplateSchema = createTemplateSchema;
exports.updateTemplateSchema = updateTemplateSchema;
exports.bulkArchiveTemplatesSchema = bulkArchiveTemplatesSchema; 
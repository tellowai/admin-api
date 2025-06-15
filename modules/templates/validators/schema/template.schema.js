'use strict';

const Joi = require('@hapi/joi');

// Character schema for video clips
const characterSchema = Joi.object({
  character: Joi.object({
    character_id: Joi.string().required(),
    character_name: Joi.string().required(),
    character_gender: Joi.string().valid('male', 'female').required()
  }).required(),
  character_prompt: Joi.string().required(),
  character_mask_prompt: Joi.string().allow(null, '').optional()
});

// Custom input field schema for static video clips
const customInputFieldSchema = Joi.object({
  label: Joi.string().required(),
  type: Joi.string().valid('text', 'date', 'image', 'video').required(),
  configuration: Joi.object({
    position: Joi.object({
      x: Joi.number().required(),
      y: Joi.number().required()
    }).required(),
    font: Joi.object({
      family: Joi.string().required(),
      size: Joi.number().required(),
      weight: Joi.string().required()
    }).required(),
    color: Joi.object({
      font: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).required(),
      background: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).allow(null).optional()
    }).required()
  }).required()
});

// Video clip schema for create operations
const videoClipSchema = Joi.object({
  clip_index: Joi.number().integer().min(1).required(),
  video_type: Joi.string().valid('ai', 'static').required(),
  created_at: Joi.string().isoDate().required(),
  updated_at: Joi.string().isoDate().required(),
  // AI video fields
  video_prompt: Joi.string().when('video_type', {
    is: 'ai',
    then: Joi.required(),
    otherwise: Joi.forbidden()
  }),
  video_ai_model: Joi.string().when('video_type', {
    is: 'ai',
    then: Joi.required(),
    otherwise: Joi.forbidden()
  }),
  video_quality: Joi.string().valid('360p', '720p', '1080p', '1440p', '2160p').when('video_type', {
    is: 'ai',
    then: Joi.optional(),
    otherwise: Joi.forbidden()
  }),
  characters: Joi.array().items(characterSchema).when('video_type', {
    is: 'ai',
    then: Joi.optional(),
    otherwise: Joi.forbidden()
  }),
  template_image_asset_key: Joi.string().when('video_type', {
    is: 'ai',
    then: Joi.optional(),
    otherwise: Joi.forbidden()
  }),
  // Static video fields
  video_file_asset_key: Joi.string().when('video_type', {
    is: 'static',
    then: Joi.required(),
    otherwise: Joi.forbidden()
  }),
  requires_user_input: Joi.boolean().when('video_type', {
    is: 'static',
    then: Joi.optional(),
    otherwise: Joi.forbidden()
  }),
  custom_input_fields: Joi.array().items(customInputFieldSchema).when('requires_user_input', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.forbidden()
  })
});

// Video clip schema for update operations (more flexible)
const updateVideoClipSchema = Joi.object({
  clip_index: Joi.number().integer().min(1).required(),
  video_type: Joi.string().valid('ai', 'static').required(),
  created_at: Joi.string().isoDate().required(),
  updated_at: Joi.string().isoDate().required(),
  // AI video fields
  video_prompt: Joi.string().when('video_type', {
    is: 'ai',
    then: Joi.required(),
    otherwise: Joi.forbidden()
  }),
  video_ai_model: Joi.string().when('video_type', {
    is: 'ai',
    then: Joi.required(),
    otherwise: Joi.forbidden()
  }),
  video_quality: Joi.string().valid('360p', '720p', '1080p', '1440p', '2160p').when('video_type', {
    is: 'ai',
    then: Joi.optional(),
    otherwise: Joi.forbidden()
  }),
  characters: Joi.array().items(characterSchema).when('video_type', {
    is: 'ai',
    then: Joi.optional(),
    otherwise: Joi.forbidden()
  }),
  // Allow template_image_asset_key for both types in updates (more flexible)
  template_image_asset_key: Joi.string().allow(null, '').optional(),
  // Static video fields
  video_file_asset_key: Joi.string().when('video_type', {
    is: 'static',
    then: Joi.required(),
    otherwise: Joi.forbidden()
  }),
  requires_user_input: Joi.boolean().when('video_type', {
    is: 'static',
    then: Joi.optional(),
    otherwise: Joi.forbidden()
  }),
  custom_input_fields: Joi.array().items(customInputFieldSchema).when('requires_user_input', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.forbidden()
  })
});

const createTemplateSchema = Joi.object().keys({
  template_name: Joi.string().max(255).required(),
  template_code: Joi.string().max(9).required(),
  template_output_type: Joi.string().valid('image', 'video', 'audio').required(),
  template_gender: Joi.string().valid('male', 'female', 'unisex', 'couple').optional(),
  description: Joi.string().allow(null),
  prompt: Joi.string().when('template_output_type', {
    is: 'image',
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  faces_needed: Joi.array().items(Joi.object().keys({
    character_name: Joi.string().required(),
    character_gender: Joi.string().valid('male', 'female', 'unisex', 'couple').required(),
    character_face_r2_url: Joi.string().optional(),
    character_face_r2_key: Joi.string().optional(),
    template_character_id: Joi.string().optional()
  })).when('template_output_type', {
    is: 'image',
    then: Joi.allow(null),
    otherwise: Joi.forbidden()
  }),
  cf_r2_key: Joi.string().max(512).allow(null),
  cf_r2_url: Joi.string().max(1000).allow(null),
  credits: Joi.number().integer().min(1).default(1),
  additional_data: Joi.object().allow(null),
  // Video specific field
  clips: Joi.when('template_output_type', {
    is: 'video',
    then: Joi.array().items(videoClipSchema).required().min(1),
    otherwise: Joi.forbidden()
  })
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
  additional_data: Joi.object().allow(null).optional(),
  clips: Joi.array().items(updateVideoClipSchema).optional()
});

exports.createTemplateSchema = createTemplateSchema;
exports.updateTemplateSchema = updateTemplateSchema; 
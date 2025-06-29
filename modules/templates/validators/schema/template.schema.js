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

// Custom text input field schema
const customTextInputFieldSchema = Joi.object({
  layer_name: Joi.string().required(),
  user_input_field_name: Joi.string().required(),
  input_field_type: Joi.string().valid('text', 'long_text', 'date').required(),
  default_text: Joi.string().allow('', null).optional()
});

// Video clip schema for create operations
const videoClipSchema = Joi.object({
  clip_index: Joi.number().integer().min(1).required(),
  video_type: Joi.string().valid('ai', 'static').required(),
  created_at: Joi.string().isoDate().required(),
  updated_at: Joi.string().isoDate().required(),
  // Asset type and generation type fields
  asset_type: Joi.string().valid('image', 'video').required(),
  generation_type: Joi.string().valid('inpainting', 'generate').default('generate').required(),
  // AI asset fields
  asset_prompt: Joi.string().allow('').when('video_type', {
    is: 'ai',
    then: Joi.when('asset_type', {
      is: 'video',
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    otherwise: Joi.forbidden()
  }),
  asset_ai_model: Joi.string().allow('').when('video_type', {
    is: 'ai',
    then: Joi.when('generation_type', {
      is: 'generate',
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    otherwise: Joi.forbidden()
  }),
  asset_quality: Joi.string().valid('360p', '720p', '1080p', '1440p', '2160p').when('video_type', {
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
  template_image_asset_bucket: Joi.string().when('video_type', {
    is: 'ai',
    then: Joi.optional(),
    otherwise: Joi.forbidden()
  }),
  reference_image_type: Joi.string().valid('ai', 'none').default('ai').optional(),
  reference_image_ai_model: Joi.string().when('reference_image_type', {
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
  video_file_asset_bucket: Joi.string().when('video_type', {
    is: 'static',
    then: Joi.optional(),
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
  // Asset type and generation type fields
  asset_type: Joi.string().valid('image', 'video').optional(),
  generation_type: Joi.string().valid('inpainting', 'generate').optional(),
  // AI asset fields
  asset_prompt: Joi.string().allow('').when('video_type', {
    is: 'ai',
    then: Joi.when('asset_type', {
      is: 'video',
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    otherwise: Joi.forbidden()
  }),
  asset_ai_model: Joi.string().allow('').when('video_type', {
    is: 'ai',
    then: Joi.when('generation_type', {
      is: 'generate',
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    otherwise: Joi.forbidden()
  }),
  asset_quality: Joi.string().valid('360p', '720p', '1080p', '1440p', '2160p').when('video_type', {
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
  template_image_asset_bucket: Joi.string().allow(null, '').optional(),
  reference_image_type: Joi.string().valid('ai', 'none').default('ai').optional(),
  reference_image_ai_model: Joi.string().allow(null, '').optional(),
  // Static video fields
  video_file_asset_key: Joi.string().when('video_type', {
    is: 'static',
    then: Joi.required(),
    otherwise: Joi.forbidden()
  }),
  video_file_asset_bucket: Joi.string().allow(null, '').optional(),
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
  })).when('template_output_type', {
    is: 'image',
    then: Joi.allow(null),
    otherwise: Joi.forbidden()
  }),
  cf_r2_key: Joi.string().max(512).allow(null),
  cf_r2_url: Joi.string().max(1000).allow(null),
  credits: Joi.number().integer().min(1).default(1),
  additional_data: Joi.object().allow(null),
  // Video specific fields
  clips: Joi.when('template_output_type', {
    is: 'video',
    then: Joi.array().items(videoClipSchema).required().min(1),
    otherwise: Joi.forbidden()
  }),
  sounds: Joi.when('template_output_type', {
    is: 'video',
    then: Joi.array().items(
      Joi.object({
        asset_key: Joi.string().required(),
        asset_bucket: Joi.string().required(),
        sound_index: Joi.number().integer().min(0).required()
      })
    ).min(1).optional(),
    otherwise: Joi.forbidden()
  }),
  // AE (After Effects) asset fields for video templates
  color_video_bucket: Joi.when('template_output_type', {
    is: 'video',
    then: Joi.string().max(255).optional(),
    otherwise: Joi.forbidden()
  }),
  color_video_key: Joi.when('template_output_type', {
    is: 'video',
    then: Joi.string().max(512).optional(),
    otherwise: Joi.forbidden()
  }),
  mask_video_bucket: Joi.when('template_output_type', {
    is: 'video',
    then: Joi.string().max(255).optional(),
    otherwise: Joi.forbidden()
  }),
  mask_video_key: Joi.when('template_output_type', {
    is: 'video',
    then: Joi.string().max(512).optional(),
    otherwise: Joi.forbidden()
  }),
  bodymovin_json_bucket: Joi.when('template_output_type', {
    is: 'video',
    then: Joi.string().max(255).optional(),
    otherwise: Joi.forbidden()
  }),
  bodymovin_json_key: Joi.when('template_output_type', {
    is: 'video',
    then: Joi.string().max(512).optional(),
    otherwise: Joi.forbidden()
  }),
  custom_text_input_fields: Joi.when('template_output_type', {
    is: 'video',
    then: Joi.array().items(customTextInputFieldSchema).optional(),
    otherwise: Joi.forbidden()
  })
});

const updateTemplateSchema = Joi.object().keys({
  template_name: Joi.string().max(255).optional(),
  template_code: Joi.string().max(255).optional(),
  template_output_type: Joi.string().valid('image', 'video', 'audio').optional(),
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
  credits: Joi.number().integer().min(1).optional(),
  additional_data: Joi.object().allow(null).optional(),
  clips: Joi.array().items(updateVideoClipSchema).optional(),
  sounds: Joi.array().items(
    Joi.object({
      asset_key: Joi.string().required(),
      asset_bucket: Joi.string().required(),
      sound_index: Joi.number().integer().min(0).required()
    })
  ).optional(),
  // AE (After Effects) asset fields for video templates
  color_video_bucket: Joi.string().max(255).optional(),
  color_video_key: Joi.string().max(512).optional(),
  mask_video_bucket: Joi.string().max(255).optional(),
  mask_video_key: Joi.string().max(512).optional(),
  bodymovin_json_bucket: Joi.string().max(255).optional(),
  bodymovin_json_key: Joi.string().max(512).optional(),
  custom_text_input_fields: Joi.array().items(customTextInputFieldSchema).optional()
});

exports.createTemplateSchema = createTemplateSchema;
exports.updateTemplateSchema = updateTemplateSchema; 
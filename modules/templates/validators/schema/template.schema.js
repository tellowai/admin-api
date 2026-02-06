'use strict';

const Joi = require('@hapi/joi');

// Custom validation for word count
const wordCountValidation = (value, helpers) => {
  if (!value || value.trim() === '') {
    return value; // Allow empty values
  }

  const wordCount = value.trim().split(/\s+/).filter(word => word.length > 0).length;

  if (wordCount > 50) {
    return helpers.error('any.invalid', {
      message: `Description must not exceed 50 words. Current word count: ${wordCount}`
    });
  }

  return value;
};

// Workflow step schema
const workflowStepSchema = Joi.object({
  workflow_id: Joi.string().required(),
  workflow_code: Joi.string().required(),
  order_index: Joi.number().integer().min(0).required(),
  data: Joi.array().items(
    Joi.object({
      type: Joi.string().required(),
      value: Joi.alternatives().try(Joi.string(), Joi.number(), Joi.object(), Joi.boolean(), Joi.array()).required()
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
  input_field_type: Joi.string().valid('text', 'short_text', 'long_text', 'date', 'datetime', 'time').required(),
  default_text: Joi.string().allow('', null).optional(),
  linked_layer_names: Joi.array().items(Joi.string()).default([]).optional(),
  format: Joi.string().allow(null).optional(),
  nfd_field_code: Joi.string().allow(null).optional(), // Matched field code from niche data field definitions
  new_field: Joi.object({
    field_code: Joi.string().required(),
    field_label: Joi.string().required(),
    field_data_type: Joi.string().valid('short_text', 'long_text', 'date', 'time', 'datetime', 'photo', 'video').required()
  }).allow(null).optional() // New field definition (will be removed before storing)
});

// Template tag schema
const templateTagSchema = Joi.object({
  facet_id: Joi.number().integer().positive().required(),
  ttd_id: Joi.number().integer().positive().required()
});

const createTemplateSchema = Joi.object().keys({
  template_name: Joi.string().max(255).required(),
  template_code: Joi.string().max(9).required(),
  template_output_type: Joi.string().valid('image', 'video', 'audio').required(),
  template_clips_assets_type: Joi.string().valid('ai', 'non-ai').required(),
  template_type: Joi.string().valid('free', 'premium', 'ai').optional(),
  template_gender: Joi.string().valid('male', 'female', 'unisex', 'couple').optional(),
  description: Joi.string().allow(null, '').custom(wordCountValidation),
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
  thumb_frame_asset_key: Joi.string().max(512).allow(null),
  thumb_frame_bucket: Joi.string().max(255).allow(null),
  color_video_bucket: Joi.string().max(255).allow(null),
  color_video_key: Joi.string().max(512).allow(null),
  mask_video_bucket: Joi.string().max(255).allow(null),
  mask_video_key: Joi.string().max(512).allow(null),
  bodymovin_json_bucket: Joi.string().max(255).allow(null),
  bodymovin_json_key: Joi.string().max(512).allow(null),
  custom_text_input_fields: Joi.array().items(customTextInputFieldSchema).allow(null),
  user_assets_layer: Joi.string().valid('top', 'bottom').default('bottom'),
  credits: Joi.number().integer().min(1).default(1),
  aspect_ratio: Joi.string().valid('9:16', '16:9', '3:4', '4:3', '1:1').allow(null).optional(),
  orientation: Joi.string().valid('horizontal', 'vertical').allow(null).optional(),
  additional_data: Joi.object().allow(null),
  niche_slug: Joi.string().max(50).allow(null, '').optional(), // Niche slug for field matching (not stored in template)
  template_tag_ids: Joi.array().items(templateTagSchema).allow(null).optional(),
  image_uploads_json: Joi.array().items(
    Joi.object({
      clip_index: Joi.number().integer().min(1).required(),
      step_index: Joi.number().integer().min(0).required(),
      gender: Joi.string().valid('male', 'female', 'unisex', 'couple').required()
    })
  ).allow(null).optional(),
  video_uploads_json: Joi.array().items(
    Joi.object({
      clip_index: Joi.number().integer().min(1).required(),
      step_index: Joi.number().integer().min(0).required(),
      gender: Joi.string().valid('male', 'female', 'unisex', 'couple').required()
    })
  ).allow(null).optional(),
  image_input_fields_json: Joi.array().items(
    Joi.object({
      image_id: Joi.string().required(),
      layer_name: Joi.string().required(),
      field_code: Joi.string().required(),
      user_input_field_name: Joi.string().allow(null, '').optional(),
      field_data_type: Joi.string().valid('short_text', 'long_text', 'date', 'time', 'datetime', 'photo', 'video').required(),
      reference_image: Joi.object({
        asset_key: Joi.string().optional(),
        bucket: Joi.string().optional()
      }).allow(null).optional()
    })
  ).allow(null).optional(),
  niche_id: Joi.number().integer().positive().allow(null).optional(),
  // Clips are required for 'ai' templates and must be empty for 'non-ai'
  clips: Joi.array()
    .items(clipSchema)
    .when('template_clips_assets_type', {
      is: 'ai',
      then: Joi.array().items(clipSchema).min(1).required(),
      otherwise: Joi.array().items(clipSchema).max(0).optional()
    })
});

// Minimal schema for creating draft template
const createDraftTemplateSchema = Joi.object().keys({
  template_name: Joi.string().max(255).required(),
  template_code: Joi.string().max(9).required(),
  cf_r2_url: Joi.string().max(1000).required(),
  cf_r2_key: Joi.string().max(512).required(),
  template_output_type: Joi.string().valid('image', 'video', 'audio').default('video'),
  status: Joi.string().valid('draft', 'review', 'active', 'inactive', 'suspended', 'archived').default('draft'),
  thumb_frame_asset_key: Joi.string().max(512).allow(null).optional(),
  thumb_frame_bucket: Joi.string().max(255).allow(null).optional()
});

const updateTemplateSchema = Joi.object().keys({
  template_name: Joi.string().max(255).optional(),
  template_code: Joi.string().max(255).optional(),
  template_output_type: Joi.string().valid('image', 'video', 'audio').optional(),
  template_clips_assets_type: Joi.string().valid('ai', 'non-ai').optional(),
  template_type: Joi.string().valid('free', 'premium', 'ai').optional(),
  template_gender: Joi.string().valid('male', 'female', 'unisex', 'couple').optional(),
  description: Joi.string().allow(null, '').custom(wordCountValidation).optional(),
  prompt: Joi.string().allow('').optional(),
  faces_needed: Joi.array().items(Joi.object().keys({
    character_name: Joi.string().optional(),
    character_gender: Joi.string().valid('male', 'female', 'unisex', 'couple').optional(),
    character_face_r2_url: Joi.string().optional(),
    character_face_r2_key: Joi.string().optional(),
    template_character_id: Joi.string().optional()
  })).allow(null),
  cf_r2_key: Joi.string().max(512).allow(null).optional(),
  cf_r2_bucket: Joi.string().max(512).allow(null).optional(),
  cf_r2_url: Joi.string().max(1000).allow(null).optional(),
  thumb_frame_asset_key: Joi.string().max(512).allow(null).optional(),
  thumb_frame_bucket: Joi.string().max(255).allow(null).optional(),
  color_video_bucket: Joi.string().max(255).allow(null).optional(),
  color_video_key: Joi.string().max(512).allow(null).optional(),
  mask_video_bucket: Joi.string().max(255).allow(null).optional(),
  mask_video_key: Joi.string().max(512).allow(null).optional(),
  bodymovin_json_bucket: Joi.string().max(255).allow(null).optional(),
  bodymovin_json_key: Joi.string().max(512).allow(null).optional(),
  custom_text_input_fields: Joi.array().items(customTextInputFieldSchema).allow(null).optional(),
  user_assets_layer: Joi.string().valid('top', 'bottom').optional(),
  credits: Joi.number().integer().min(1).optional(),
  aspect_ratio: Joi.string().valid('9:16', '16:9', '3:4', '4:3', '1:1').allow(null).optional(),
  orientation: Joi.string().valid('horizontal', 'vertical').allow(null).optional(),
  niche_slug: Joi.string().max(50).allow(null, '').optional(), // Niche slug for field matching (not stored in template)
  additional_data: Joi.object().allow(null).optional(),
  template_tag_ids: Joi.array().items(templateTagSchema).allow(null).optional(),
  image_uploads_required: Joi.number().integer().min(0).optional(),
  video_uploads_required: Joi.number().integer().min(0).optional(),
  image_uploads_json: Joi.array().items(
    Joi.object({
      clip_index: Joi.number().integer().min(1).required(),
      step_index: Joi.number().integer().min(0).required(),
      gender: Joi.string().valid('male', 'female', 'unisex', 'couple').required()
    })
  ).allow(null).optional(),
  video_uploads_json: Joi.array().items(
    Joi.object({
      clip_index: Joi.number().integer().min(1).required(),
      step_index: Joi.number().integer().min(0).required(),
      gender: Joi.string().valid('male', 'female', 'unisex', 'couple').required()
    })
  ).allow(null).optional(),
  image_input_fields_json: Joi.array().items(
    Joi.object({
      image_id: Joi.string().required(),
      layer_name: Joi.string().required(),
      field_code: Joi.string().allow(null, '').optional(),
      user_input_field_name: Joi.string().allow(null, '').optional(),
      field_data_type: Joi.string().valid('short_text', 'long_text', 'date', 'time', 'datetime', 'photo', 'video').required(),
      reference_image: Joi.object({
        asset_key: Joi.string().optional(),
        bucket: Joi.string().optional()
      }).allow(null).optional()
    })
  ).allow(null).optional(),
  niche_id: Joi.number().integer().positive().allow(null).optional(),
  clips: Joi.array().items(clipSchema).optional()
});

const bulkArchiveTemplatesSchema = Joi.object().keys({
  template_ids: Joi.array().items(Joi.string().required()).min(1).max(50).required()
});

const bulkUnarchiveTemplatesSchema = Joi.object().keys({
  template_ids: Joi.array().items(Joi.string().required()).min(1).max(50).required()
});

const updateTemplateStatusSchema = Joi.object().keys({
  status: Joi.string().valid('active', 'inactive').required()
});

const bulkUpdateTemplatesStatusSchema = Joi.object().keys({
  template_ids: Joi.array().items(Joi.string().required()).min(1).max(50).required(),
  status: Joi.string().valid('active', 'inactive').required()
});

const exportTemplatesSchema = Joi.object().keys({
  template_ids: Joi.array().items(Joi.string().required()).min(1).max(100).required()
});

// Asset object schema for import
const assetObjectSchema = Joi.object({
  asset_key: Joi.string().allow(null).optional(),
  asset_bucket: Joi.string().allow(null).optional()
}).allow(null);

// Import template schema
const importTemplateObjectSchema = Joi.object({
  template_id: Joi.string().optional(),
  template_name: Joi.string().required(),
  template_code: Joi.string().required(),
  template_gender: Joi.string().valid('male', 'female', 'couple', 'unisex').optional(),
  description: Joi.string().allow('', null).optional(),
  prompt: Joi.string().allow('', null).optional(),
  faces_needed: Joi.array().optional(),
  custom_text_input_fields: Joi.array().items(customTextInputFieldSchema).optional(),
  credits: Joi.number().integer().min(0).optional(),
  total_images_count: Joi.number().integer().min(0).allow(null).optional(),
  total_videos_count: Joi.number().integer().min(0).allow(null).optional(),
  total_texts_count: Joi.number().integer().min(0).allow(null).optional(),
  image_uploads_required: Joi.number().integer().min(0).optional(),
  video_uploads_required: Joi.number().integer().min(0).optional(),
  image_uploads_json: Joi.array().allow(null).optional(),
  video_uploads_json: Joi.array().allow(null).optional(),
  aspect_ratio: Joi.string().valid('9:16', '16:9', '3:4', '4:3', '1:1').allow(null).optional(),
  orientation: Joi.string().valid('horizontal', 'vertical').allow(null).optional(),
  template_output_type: Joi.string().valid('image', 'video', 'audio').default('image'),
  template_clips_assets_type: Joi.string().valid('ai', 'non-ai').optional(),
  user_assets_layer: Joi.string().valid('top', 'bottom').default('bottom'),
  additional_data: Joi.object().allow(null).optional(),
  cf_r2_asset: assetObjectSchema,
  thumb_frame_asset: assetObjectSchema,
  color_video_asset: assetObjectSchema,
  mask_video_asset: assetObjectSchema,
  bodymovin_json_asset: assetObjectSchema,
  clips: Joi.array().items(clipSchema).optional(),
  created_at: Joi.alternatives().try(Joi.date(), Joi.string()).optional()
}).unknown(true);

const importTemplatesSchema = Joi.object().keys({
  meta: Joi.object().optional(),
  templates: Joi.array().items(importTemplateObjectSchema).min(1).max(50).required()
});

// Ensure AI clips: one entry per clip (creates template_ai_clips + workflow per clip)
const ensureAiClipsClipSchema = Joi.object({
  clip_index: Joi.number().integer().min(0).required(),
  asset_type: Joi.string().valid('image', 'video').default('video')
});

const ensureAiClipsSchema = Joi.object().keys({
  clips: Joi.array().items(ensureAiClipsClipSchema).min(1).required()
});

exports.createTemplateSchema = createTemplateSchema;
exports.createDraftTemplateSchema = createDraftTemplateSchema;
exports.updateTemplateSchema = updateTemplateSchema;
exports.bulkArchiveTemplatesSchema = bulkArchiveTemplatesSchema;
exports.bulkUnarchiveTemplatesSchema = bulkUnarchiveTemplatesSchema;
exports.updateTemplateStatusSchema = updateTemplateStatusSchema;
exports.bulkUpdateTemplatesStatusSchema = bulkUpdateTemplatesStatusSchema;
exports.exportTemplatesSchema = exportTemplatesSchema;
exports.importTemplatesSchema = importTemplatesSchema;
exports.ensureAiClipsSchema = ensureAiClipsSchema;
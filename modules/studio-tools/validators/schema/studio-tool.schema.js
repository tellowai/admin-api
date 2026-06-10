'use strict';

const Joi = require('@hapi/joi');

const workflowSchema = Joi.object({
  input_image_url: Joi.string().allow('').optional(),
  input_media_type: Joi.string().valid('video', 'gif', 'image', 'auto').optional(),
  arrow_image_url: Joi.string().allow('').optional(),
  output_media_url: Joi.string().allow('').optional(),
  output_media_type: Joi.string().valid('video', 'gif', 'image', 'auto').optional(),
  input_label: Joi.string().allow('').optional(),
  output_label: Joi.string().allow('').optional(),
  tool_preview_image_key: Joi.string().max(1024).allow('').optional(),
  tool_preview_image_bucket: Joi.string().max(128).allow('').optional(),
}).optional();

const badgeSchema = Joi.object({
  text: Joi.string().required(),
  variant: Joi.string().valid('accent', 'muted').default('muted'),
});

const categorySchema = Joi.object({
  id: Joi.string().max(64).required(),
  label: Joi.string().max(128).required(),
});

const uuidLike = Joi.string().max(36).min(32);

const createStudioToolSchema = Joi.object({
  tool_key: Joi.string().max(64).required(),
  template_id: uuidLike.required(),
  title: Joi.string().max(255).required(),
  cta_text: Joi.string().max(64).default('Create'),
  eta: Joi.string().max(32).allow('', null).optional(),
  flow_text: Joi.string().max(255).allow('', null).optional(),
  icon: Joi.string().max(64).allow('', null).optional(),
  icon_color: Joi.string().max(32).allow('', null).optional(),
  icon_image_url: Joi.string().max(1024).allow('', null).optional(),
  workflow: workflowSchema,
  badges: Joi.array().items(badgeSchema).max(8).optional(),
  category_ids: Joi.array().items(Joi.string().max(64)).optional(),
  is_featured: Joi.boolean().default(false),
  status: Joi.string().valid('active', 'inactive').default('active'),
  sort_order: Joi.number().integer().min(0).optional(),
});

const updateStudioToolSchema = Joi.object({
  tool_key: Joi.string().max(64).optional(),
  template_id: uuidLike.optional(),
  title: Joi.string().max(255).optional(),
  cta_text: Joi.string().max(64).optional(),
  eta: Joi.string().max(32).allow('', null).optional(),
  flow_text: Joi.string().max(255).allow('', null).optional(),
  icon: Joi.string().max(64).allow('', null).optional(),
  icon_color: Joi.string().max(32).allow('', null).optional(),
  icon_image_url: Joi.string().max(1024).allow('', null).optional(),
  workflow: workflowSchema,
  badges: Joi.array().items(badgeSchema).max(8).optional(),
  category_ids: Joi.array().items(Joi.string().max(64)).optional(),
  is_featured: Joi.boolean().optional(),
  status: Joi.string().valid('active', 'inactive').optional(),
  sort_order: Joi.number().integer().min(0).optional(),
});

const updateSortOrderSchema = Joi.object({
  tool_ids: Joi.array().items(uuidLike).min(1).unique().required(),
});

const updatePageConfigSchema = Joi.object({
  enabled: Joi.boolean().optional(),
  title: Joi.string().max(255).optional(),
  subtitle: Joi.string().max(512).optional(),
  categories: Joi.array().items(categorySchema).optional(),
});

exports.createStudioToolSchema = createStudioToolSchema;
exports.updateStudioToolSchema = updateStudioToolSchema;
exports.updateSortOrderSchema = updateSortOrderSchema;
exports.updatePageConfigSchema = updatePageConfigSchema;

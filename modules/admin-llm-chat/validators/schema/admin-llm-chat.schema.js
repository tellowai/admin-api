'use strict';

const Joi = require('@hapi/joi');

module.exports = {
  createConversationSchema: Joi.object({
    title: Joi.string().max(512).optional(),
    model_provider: Joi.string().valid('openai', 'anthropic').required(),
    model_id: Joi.string().required(),
    system_prompt_version: Joi.string().optional(),
    parent_conversation_id: Joi.string().optional(),
    forked_from_message_id: Joi.string().optional(),
  }),
  patchConversationSchema: Joi.object({
    title: Joi.string().max(512).optional(),
    archived_at: Joi.date().iso().allow(null).optional(),
    pinned_at: Joi.date().iso().allow(null).optional(),
  }),
  streamMessageSchema: Joi.object({
    content: Joi.string().max(100000).required(),
    content_parts: Joi.array().optional(),
    client_message_id: Joi.string().optional(),
    attachment_ids: Joi.array().items(Joi.string()).max(10).optional(),
    model_provider: Joi.string().valid('openai', 'anthropic').optional(),
    model_id: Joi.string().max(128).optional(),
  }),
  presignAttachmentSchema: Joi.object({
    conversation_id: Joi.string().required(),
    contentType: Joi.string().required(),
    extension: Joi.string().max(16).optional().allow(''),
    size_bytes: Joi.number().integer().positive().optional(),
  }),
  registerAttachmentSchema: Joi.object({
    attachment_id: Joi.string().required(),
    conversation_id: Joi.string().required(),
    mime_type: Joi.string().required(),
    size_bytes: Joi.number().integer().positive().required(),
    storage_key: Joi.string().required(),
    original_name: Joi.string().required(),
    public_url: Joi.string().max(2048).optional().allow('', null),
  }),
  businessContextSchema: Joi.object().unknown(true),
  digestSchema: Joi.object({
    date: Joi.string().optional(),
    business_context: Joi.object().optional(),
  }),
  upsertMemorySchema: Joi.object({
    value: Joi.string().max(4000).required(),
  }),
  updateProfileSchema: Joi.object({
    preferred_metrics: Joi.array().items(Joi.string()).optional(),
    focus_channels: Joi.array().items(Joi.string()).optional(),
    currency: Joi.string().max(16).allow(null).optional(),
    default_date_range: Joi.string().max(64).allow(null).optional(),
    reporting_notes: Joi.string().max(2000).allow(null).optional(),
  }).unknown(false),
};

'use strict';

const Joi = require('@hapi/joi');

const paywallTitleTemplatesField = Joi.alternatives().try(
  Joi.array().items(Joi.string().max(255)).max(20),
  Joi.string().max(255).allow('', null)
).optional();

const createNicheSchema = Joi.object().keys({
  niche_name: Joi.string().max(100).required(),
  thumb_image_object_key: Joi.string().max(255).required(),
  thumb_image_storage_bucket: Joi.string().max(100).required(),
  slug: Joi.string().max(50).required(),
  display_order: Joi.number().integer().allow(null).optional(),
  is_active: Joi.boolean().optional(),
  profile_title_template: Joi.string().max(255).allow('', null).optional(),
  paywall_title_template: paywallTitleTemplatesField,
  ai_paywall_title_template: paywallTitleTemplatesField
});

const updateNicheSchema = Joi.object().keys({
  niche_name: Joi.string().max(100).optional(),
  thumb_image_object_key: Joi.string().max(255).optional(),
  thumb_image_storage_bucket: Joi.string().max(100).optional(),
  // slug is not updatable - removed from update schema
  display_order: Joi.number().integer().allow(null).optional(),
  is_active: Joi.boolean().optional(),
  profile_title_template: Joi.string().max(255).allow('', null).optional(),
  paywall_title_template: paywallTitleTemplatesField,
  ai_paywall_title_template: paywallTitleTemplatesField
});

const additionalDataSchema = Joi.object({
  screen_heading: Joi.string().max(200).allow('', null).optional(),
  screen_subheading: Joi.string().max(500).allow('', null).optional()
})
  .allow(null)
  .optional();

const bulkCreateFieldDefinitionsSchema = Joi.object().keys({
  fields: Joi.array().items(
    Joi.object().keys({
      field_code: Joi.string().max(100).required(),
      field_label: Joi.string().max(100).required(),
      field_data_type: Joi.string().valid('short_text', 'long_text', 'date', 'time', 'datetime', 'photo', 'video').required(),
      is_visible_in_first_time_flow: Joi.boolean().optional(),
      display_order: Joi.number().integer().allow(null).optional(),
      placeholder_text: Joi.string().max(500).allow('', null).optional(),
      additional_data: additionalDataSchema
    })
  ).min(1).required()
});

const bulkUpdateFieldDefinitionsSchema = Joi.object().keys({
  fields: Joi.array().items(
    Joi.object().keys({
      ndfd_id: Joi.number().integer().positive().required(),
      // field_code is not updatable - removed from update schema
      field_label: Joi.string().max(100).optional(),
      field_data_type: Joi.string().valid('short_text', 'long_text', 'date', 'time', 'datetime', 'photo', 'video').optional(),
      is_visible_in_first_time_flow: Joi.boolean().optional(),
      display_order: Joi.number().integer().allow(null).optional(),
      placeholder_text: Joi.string().max(500).allow('', null).optional(),
      additional_data: additionalDataSchema
    })
  ).min(1).required()
});

const bulkArchiveFieldDefinitionsSchema = Joi.object().keys({
  ndfd_ids: Joi.array().items(Joi.number().integer().positive()).min(1).required()
});

const matchCustomTextInputFieldsSchema = Joi.object().keys({
  niche_slug: Joi.string().max(50).required(),
  custom_text_input_fields: Joi.array().items(
    Joi.object().keys({
      layer_name: Joi.string().required(),
      default_text: Joi.string().required(),
      input_field_type: Joi.string().valid('text', 'short_text', 'long_text', 'date', 'time', 'datetime', 'photo', 'video').required(),
      linked_layer_names: Joi.array().items(Joi.string()).optional(),
      user_input_field_name: Joi.string().required(),
      text_casing: Joi.string()
        .valid('none', 'uppercase', 'lowercase', 'capitalize_first', 'title_case', 'sentence_case')
        .optional(),
      use_custom_ae_text: Joi.boolean().optional(),
      text_output_template: Joi.string().allow('', null).max(4000).optional()
    })
  ).min(1).required()
});

exports.createNicheSchema = createNicheSchema;
exports.updateNicheSchema = updateNicheSchema;
exports.bulkCreateFieldDefinitionsSchema = bulkCreateFieldDefinitionsSchema;
exports.bulkUpdateFieldDefinitionsSchema = bulkUpdateFieldDefinitionsSchema;
exports.bulkArchiveFieldDefinitionsSchema = bulkArchiveFieldDefinitionsSchema;
exports.matchCustomTextInputFieldsSchema = matchCustomTextInputFieldsSchema;


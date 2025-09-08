'use strict';

const Joi = require('@hapi/joi');

const createExploreSectionSchema = Joi.object().keys({
  section_name: Joi.string().max(255).required(),
  layout_type: Joi.string().valid('horizontal_scroller', 'vertical_grid', 'masonry').default('horizontal_scroller'),
  section_items_type: Joi.string().valid('manual', 'latest', 'track_collection', 'track_pack').default('manual'),
  section_type: Joi.string().valid('template', 'collection', 'pack', 'mixed').default('mixed'),
  ui_type: Joi.string().valid('normal', 'compact').default('normal'),
  sort_order: Joi.number().integer().min(0).default(0),
  status: Joi.string().valid('active', 'inactive').default('active'),
  additional_data: Joi.object().allow(null)
});

const updateExploreSectionSchema = Joi.object().keys({
  section_name: Joi.string().max(255).optional(),
  layout_type: Joi.string().valid('horizontal_scroller', 'vertical_grid', 'masonry').optional(),
  section_items_type: Joi.string().valid('manual', 'latest', 'track_collection', 'track_pack').optional(),
  section_type: Joi.string().valid('template', 'collection', 'pack', 'mixed').optional(),
  ui_type: Joi.string().valid('normal', 'compact').optional(),
  sort_order: Joi.number().integer().min(0).optional(),
  status: Joi.string().valid('active', 'inactive').optional(),
  additional_data: Joi.object().allow(null).optional()
});

const updateSortOrderSchema = Joi.array().items(
  Joi.object().keys({
    section_id: Joi.number().integer().required(),
    sort_order: Joi.number().integer().min(0).required()
  })
).min(1).required();

exports.createExploreSectionSchema = createExploreSectionSchema;
exports.updateExploreSectionSchema = updateExploreSectionSchema;
exports.updateSortOrderSchema = updateSortOrderSchema; 
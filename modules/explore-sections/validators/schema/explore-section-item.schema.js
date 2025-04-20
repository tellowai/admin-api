'use strict';

const Joi = require('@hapi/joi');

const addSectionItemsSchema = Joi.array().items(
  Joi.object().keys({
    section_id: Joi.number().integer().required(),
    resource_type: Joi.string().valid('template', 'collection', 'pack').required(),
    resource_id: Joi.alternatives().try(
      Joi.string().uuid(),
      Joi.number().integer()
    ).required(),
    sort_order: Joi.number().integer().min(0).optional()
  })
).min(1).required();

const removeSectionItemsSchema = Joi.object().keys({
  item_ids: Joi.array().items(
    Joi.string().uuid().required()
  ).min(1).required()
});

const addCollectionTemplatesSchema = Joi.object().keys({
  collection_id: Joi.alternatives().try(
    Joi.string().uuid(),
    Joi.number().integer()
  ).required()
});

exports.addSectionItemsSchema = addSectionItemsSchema;
exports.removeSectionItemsSchema = removeSectionItemsSchema;
exports.addCollectionTemplatesSchema = addCollectionTemplatesSchema; 
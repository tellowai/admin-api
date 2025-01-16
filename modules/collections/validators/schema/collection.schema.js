'use strict';

const Joi = require('@hapi/joi');

const createCollectionSchema = Joi.object().keys({
  collection_name: Joi.string().max(255).required(),
  thumbnail_cf_r2_key: Joi.string().max(512).allow(null),
  thumbnail_cf_r2_url: Joi.string().max(1000).allow(null),
  additional_data: Joi.object().allow(null)
});

const updateCollectionSchema = Joi.object().keys({
  collection_name: Joi.string().max(255).optional(),
  thumbnail_cf_r2_key: Joi.string().max(512).allow(null).optional(),
  thumbnail_cf_r2_url: Joi.string().max(1000).allow(null).optional(),
  additional_data: Joi.object().allow(null).optional()
});

exports.createCollectionSchema = createCollectionSchema;
exports.updateCollectionSchema = updateCollectionSchema; 
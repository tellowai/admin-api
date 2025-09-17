'use strict';

const Joi = require('@hapi/joi');

const dateRangeSchema = Joi.object().keys({
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().min(Joi.ref('start_date')).required(),
  start_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  end_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional()
});

const characterAnalyticsSchema = Joi.object().keys({
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().min(Joi.ref('start_date')).required(),
  start_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  end_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  gender: Joi.string().valid('male', 'female', 'couple', 'unknown').optional(),
  character_id: Joi.string().optional(),
  user_id: Joi.string().optional()
});

const templateAnalyticsSchema = Joi.object().keys({
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().min(Joi.ref('start_date')).required(),
  start_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  end_time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).optional(),
  output_type: Joi.string().valid('image', 'video', 'audio', 'pdf', 'website', 'unknown').optional(),
  aspect_ratio: Joi.string().valid('9:16', '16:9', '3:4', '4:3', '1:1', 'unknown').optional(),
  orientation: Joi.string().valid('horizontal', 'vertical', 'unknown').optional(),
  generation_type: Joi.string().valid('ai', 'non-ai', 'unknown').optional(),
  template_id: Joi.string().optional(),
  user_id: Joi.string().optional()
});

exports.dateRangeSchema = dateRangeSchema;
exports.characterAnalyticsSchema = characterAnalyticsSchema;
exports.templateAnalyticsSchema = templateAnalyticsSchema;

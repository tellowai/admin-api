'use strict';

const Joi = require('@hapi/joi');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateCreateAiModel = async function(req, res, next) {
  try {
    const schema = Joi.object({
      model_id: Joi.string().required().min(1).max(50),
      amp_platform_id: Joi.number().integer().required(),
      model_name: Joi.string().required().min(1).max(100),
      description: Joi.string().optional().allow('', null).max(65535),
      platform_model_id: Joi.string().required().min(1).max(100),
      input_types: Joi.array().items(Joi.string()).optional(),
      output_types: Joi.array().items(Joi.string()).optional(),
      supported_video_qualities: Joi.array().items(Joi.string()).optional().allow(null).when('output_types', {
        is: Joi.array().items(Joi.string()).has('video'),
        then: Joi.required().messages({
          'any.required': '\"supported_video_qualities\" is required when output_types contains \"video\"'
        })
      }),
      costs: Joi.object().optional(),
      generation_time_ms: Joi.number().integer().min(0).optional(),
      status: Joi.string().valid('active', 'inactive', 'disabled').optional().default('active')
    });

    const { error, value } = schema.validate(req.body);

    if (error) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: error.details[0].message
      });
    }

    req.validatedBody = value;
    next();
  } catch (err) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: req.t('ai_model:INVALID_AI_MODEL_DATA')
    });
  }
};
exports.validateUpdateAiModel = async function(req, res, next) {
  try {
    const schema = Joi.object({
      model_name: Joi.string().min(1).max(100),
      description: Joi.string().allow('').max(65535),
      platform_model_id: Joi.string().min(1).max(100),
      input_types: Joi.array().items(Joi.string()),
      output_types: Joi.array().items(Joi.string()),
      supported_video_qualities: Joi.array().items(Joi.string()).allow(null).when('output_types', {
        is: Joi.array().items(Joi.string()).has('video'),
        then: Joi.required().messages({
          'any.required': '\"supported_video_qualities\" is required when output_types contains \"video\"'
        })
      }),
      costs: Joi.object(),
      generation_time_ms: Joi.number().integer().min(0),
      status: Joi.string().valid('active', 'inactive', 'disabled')
    }).min(1).options({ stripUnknown: true });

    const { error, value } = schema.validate(req.body);

    if (error) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: error.details[0].message
      });
    }

    req.validatedBody = value;
    next();
  } catch (err) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: req.t('ai_model:INVALID_AI_MODEL_DATA')
    });
  }
};

exports.validateCreatePlatform = async function(req, res, next) {
  try {
    const schema = Joi.object({
      platform_name: Joi.string().required().min(1).max(100),
      platform_code: Joi.string().required().min(1).max(50),
      description: Joi.string().optional().allow('').max(65535),
      platform_logo_key: Joi.string().optional().allow(null, '').max(512),
      platform_logo_bucket: Joi.string().optional().allow(null, '').max(255)
    });

    const { error, value } = schema.validate(req.body);

    if (error) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: error.details[0].message
      });
    }

    req.validatedBody = value;
    next();
  } catch (err) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: req.t('ai_model:INVALID_AI_MODEL_DATA')
    });
  }
};

exports.validateUpdatePlatform = async function(req, res, next) {
  try {
    const schema = Joi.object({
      platform_name: Joi.string().min(1).max(100),
      description: Joi.string().optional().allow('', null).max(65535),
      platform_logo_key: Joi.string().optional().allow(null, '').max(512),
      platform_logo_bucket: Joi.string().optional().allow(null, '').max(255)
    }).min(1);

    const { error, value } = schema.validate(req.body);

    if (error) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: error.details[0].message
      });
    }

    req.validatedBody = value;
    next();
  } catch (err) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: req.t('ai_model:INVALID_AI_MODEL_DATA')
    });
  }
}; 
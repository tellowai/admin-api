'use strict';

const Joi = require('@hapi/joi');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateCreateAiModelTag = async function(req, res, next) {
  try {
    const schema = Joi.object({
      tag_name: Joi.string().required().min(1).max(36).trim(),
      tag_code: Joi.string().required().min(1).max(36).trim().pattern(/^[a-zA-Z0-9_-]+$/),
      tag_description: Joi.string().optional().allow('', null).max(65535).trim()
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
      message: req.t('ai_model_tag:INVALID_TAG_DATA')
    });
  }
};

exports.validateUpdateAiModelTag = async function(req, res, next) {
  try {
    const schema = Joi.object({
      tag_name: Joi.string().min(1).max(36).trim(),
      tag_code: Joi.string().min(1).max(36).trim().pattern(/^[a-zA-Z0-9_-]+$/),
      tag_description: Joi.string().allow('').max(65535).trim()
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
      message: req.t('ai_model_tag:INVALID_TAG_DATA')
    });
  }
};

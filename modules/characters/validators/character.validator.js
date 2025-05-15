'use strict';

const Joi = require('@hapi/joi');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateCreateUserCharacter = async function(req, res, next) {
  try {
    const schema = Joi.object({
      character_name: Joi.string().required().min(1).max(255).regex(/^[a-zA-Z0-9 ]+$/),
      character_type: Joi.string().valid('individual', 'couple').required(),
      character_gender: Joi.string().valid('male', 'female').when('character_type', {
        is: 'individual',
        then: Joi.required(),
        otherwise: Joi.optional().allow(null),
      }),
      character_description: Joi.string().optional().allow('').max(255),
      thumb_cf_r2_key: Joi.string().optional().allow('').max(512),
      thumb_cf_r2_url: Joi.string().optional().allow('').max(1000),
      trigger_word: Joi.string().optional().min(1).max(255).regex(/^[a-zA-Z0-9_]+$/),
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
      message: req.t('character:INVALID_REQUEST_DATA')
    });
  }
};

exports.validateUpdateUserCharacter = async function(req, res, next) {
  try {
    const schema = Joi.object({
      character_name: Joi.string().min(1).max(255).optional(),
      character_gender: Joi.string().valid('Male', 'Female', 'Non-binary', 'Other').optional(),
      character_description: Joi.string().allow('').max(255).optional(),
      thumb_cf_r2_key: Joi.string().allow('').max(512).optional(),
      thumb_cf_r2_url: Joi.string().allow('').uri().max(1000).optional()
    }).min(1); // At least one field must be provided

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
      message: req.t('character:INVALID_REQUEST_DATA')
    });
  }
};

exports.validateUpdateCharacterMobile = async function(req, res, next) {
  try {
    const schema = Joi.object({
      character_mobile: Joi.string().allow('').pattern(/^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,3}[-\s.]?[0-9]{4,10}$/).max(20).optional()
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
      message: req.t('character:INVALID_REQUEST_DATA')
    });
  }
}; 
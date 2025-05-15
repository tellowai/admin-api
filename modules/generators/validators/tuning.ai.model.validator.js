'use strict';

const Joi = require('@hapi/joi');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateCreatePhotoTuningSession = async function(req, res, next) {
  try {
    const schema = Joi.object({
      user_character_id: Joi.string().required()
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
      message: req.t('generator:INVALID_REQUEST_DATA')
    });
  }
};

/**
 * Validate get tuning session date request
 */
exports.validateGetTuningSessionDate = function(req, res, next) {
  const { userCharacterId } = req.params;

  if (!userCharacterId) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: req.t('common:INVALID_PARAMS'),
      errors: ['userCharacterId is required']
    });
  }

  next();
};

/**
 * Validate get tuning status request
 */
exports.validateGetTuningStatus = function(req, res, next) {
  const { userCharacterId } = req.params;

  if (!userCharacterId) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: req.t('common:INVALID_PARAMS'),
      errors: ['userCharacterId is required']
    });
  }

  next();
}; 
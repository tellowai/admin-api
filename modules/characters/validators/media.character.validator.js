'use strict';

const Joi = require('@hapi/joi');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateUploadMediaToCharacter = async function(req, res, next) {
  try {
    const schema = Joi.object({
      media: Joi.array().items(Joi.object({
        cf_r2_key: Joi.string().required().max(512),
        cf_r2_url: Joi.string().required().uri().max(1000),
        media_type: Joi.string().valid('image', 'video', 'audio', 'json', 'zip', 'safetensors').required(),
      })).required().min(1).max(36)
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
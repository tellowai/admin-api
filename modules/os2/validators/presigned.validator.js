'use strict';

const Joi = require('@hapi/joi');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validatePresignedUrlGeneration = async function(req, res, next) {
  try {
    const fileSchema = Joi.object({
      contentType: Joi.string().required(),
      extension: Joi.string().optional().allow(''),
      metadata: Joi.object().optional(),
      state: Joi.any().optional()
    });

    const schema = Joi.object({
      files: Joi.array().items(fileSchema).min(1).required()
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
      message: req.t('os2:INVALID_REQUEST_DATA')
    });
  }
}; 

'use strict';

const Joi = require('@hapi/joi');
const validationCtrl = require('../../core/controllers/validation.controller');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

const optedStatsQuerySchema = Joi.object({
  start_date: Joi.alternatives().try(Joi.date(), Joi.string()).optional().allow(''),
  end_date: Joi.alternatives().try(Joi.date(), Joi.string()).optional().allow(''),
  tz: Joi.string().optional().allow(''),
});

exports.validateContentLanguageOptedStatsQuery = function (req, res, next) {
  const payloadValidation = validationCtrl.validate(optedStatsQuerySchema, req.query);
  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error,
    });
  }
  req.validatedQuery = payloadValidation.value;
  return next(null);
};

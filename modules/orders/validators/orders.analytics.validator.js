'use strict';

const Joi = require('@hapi/joi');
const validationCtrl = require('../../core/controllers/validation.controller');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

const ordersAnalyticsQuerySchema = Joi.object({
  start_date: Joi.alternatives().try(Joi.date(), Joi.string()).required(),
  end_date: Joi.alternatives().try(Joi.date(), Joi.string()).required(),
  tz: Joi.string().optional().allow(''),
  product_type: Joi.string().valid('', 'alacarte', 'subscription', 'onetime', 'addon').optional().allow('')
});

exports.validateOrdersAnalyticsQuery = function (req, res, next) {
  const payloadValidation = validationCtrl.validate(ordersAnalyticsQuerySchema, req.query);
  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }
  req.validatedQuery = payloadValidation.value;
  return next(null);
};

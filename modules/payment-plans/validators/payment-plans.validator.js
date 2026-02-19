'use strict';

const Joi = require('@hapi/joi');
const validationCtrl = require('../../core/controllers/validation.controller');
const planSchema = require('./schema/payment-plans.schema');
const { CODES } = require('../../core/controllers/httpcodes.server.controller');

const planIdParamSchema = Joi.object({
  planId: Joi.alternatives().try(
    Joi.number().integer().positive(),
    Joi.string().pattern(/^\d+$/).messages({ 'string.pattern.base': 'planId must be a positive integer' })
  ).required()
});

exports.validatePlanIdParam = function (req, res, next) {
  const validation = validationCtrl.validate(planIdParamSchema, req.params);
  if (validation.error && validation.error.length) {
    return res.status(CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: validation.error
    });
  }
  req.params.planId = validation.value.planId;
  return next(null);
};

exports.validateCreatePlanData = function (req, res, next) {
  const payload = req.body;

  const payloadValidation = validationCtrl.validate(planSchema.createPaymentPlanSchema, payload);

  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdatePlanData = function (req, res, next) {
  const payload = req.body;

  const payloadValidation = validationCtrl.validate(planSchema.updatePaymentPlanSchema, payload);

  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateToggleStatusData = function (req, res, next) {
  const payload = req.body;

  const payloadValidation = validationCtrl.validate(planSchema.toggleStatusSchema, payload);

  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

'use strict';

const validationCtrl = require('../../core/controllers/validation.controller');
const planSchema = require('./schema/payment-plans.schema');
const { CODES } = require('../../core/controllers/httpcodes.server.controller');

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

'use strict';

const validationCtrl = require('../../core/controllers/validation.controller');
const studioToolSchema = require('./schema/studio-tool.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateCreateStudioToolData = function (req, res, next) {
  const payloadValidation = validationCtrl.validate(studioToolSchema.createStudioToolSchema, req.body);
  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error,
    });
  }
  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdateStudioToolData = function (req, res, next) {
  const payloadValidation = validationCtrl.validate(studioToolSchema.updateStudioToolSchema, req.body);
  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error,
    });
  }
  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdateSortOrderData = function (req, res, next) {
  const payloadValidation = validationCtrl.validate(studioToolSchema.updateSortOrderSchema, req.body);
  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error,
    });
  }
  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdatePageConfigData = function (req, res, next) {
  const payloadValidation = validationCtrl.validate(studioToolSchema.updatePageConfigSchema, req.body);
  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error,
    });
  }
  req.validatedBody = payloadValidation.value;
  return next(null);
};

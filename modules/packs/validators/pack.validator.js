'use strict';

const validationCtrl = require('../../core/controllers/validation.controller');
const packSchema = require('./schema/pack.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateCreatePackData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(packSchema.createPackSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdatePackData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(packSchema.updatePackSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateAddTemplatesData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(packSchema.addTemplatesSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateRemoveTemplatesData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(packSchema.removeTemplatesSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
}; 
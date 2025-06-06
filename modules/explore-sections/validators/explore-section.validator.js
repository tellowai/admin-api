'use strict';

const validationCtrl = require('../../core/controllers/validation.controller');
const exploreSectionSchema = require('./schema/explore-section.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateCreateExploreSectionData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(exploreSectionSchema.createExploreSectionSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdateExploreSectionData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(exploreSectionSchema.updateExploreSectionSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdateSortOrderData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(exploreSectionSchema.updateSortOrderSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
}; 
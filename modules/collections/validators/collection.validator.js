'use strict';

const validationCtrl = require('../../core/controllers/validation.controller');
const collectionSchema = require('./schema/collection.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateCreateCollectionData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(collectionSchema.createCollectionSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdateCollectionData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(collectionSchema.updateCollectionSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
}; 
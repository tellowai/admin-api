'use strict';

const validationCtrl = require('../../core/controllers/validation.controller');
const nicheSchema = require('./schema/niche.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateCreateNicheData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(nicheSchema.createNicheSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdateNicheData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(nicheSchema.updateNicheSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateBulkCreateFieldDefinitionsData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(nicheSchema.bulkCreateFieldDefinitionsSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateBulkUpdateFieldDefinitionsData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(nicheSchema.bulkUpdateFieldDefinitionsSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateBulkArchiveFieldDefinitionsData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(nicheSchema.bulkArchiveFieldDefinitionsSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateMatchCustomTextInputFieldsData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(nicheSchema.matchCustomTextInputFieldsSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};


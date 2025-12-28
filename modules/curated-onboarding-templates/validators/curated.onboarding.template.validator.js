'use strict';

const validationCtrl = require('../../core/controllers/validation.controller');
const curatedOnboardingTemplateSchema = require('./schema/curated.onboarding.template.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateCreateCuratedOnboardingTemplateData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(
    curatedOnboardingTemplateSchema.createCuratedOnboardingTemplateSchema, 
    payload
  );
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdateCuratedOnboardingTemplateData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(
    curatedOnboardingTemplateSchema.updateCuratedOnboardingTemplateSchema, 
    payload
  );
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateBulkCreateCuratedOnboardingTemplatesData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(
    curatedOnboardingTemplateSchema.bulkCreateCuratedOnboardingTemplatesSchema, 
    payload
  );
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateBulkArchiveCuratedOnboardingTemplatesData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(
    curatedOnboardingTemplateSchema.bulkArchiveCuratedOnboardingTemplatesSchema, 
    payload
  );
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateBulkArchiveByTemplateIdsData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(
    curatedOnboardingTemplateSchema.bulkArchiveByTemplateIdsSchema, 
    payload
  );
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};


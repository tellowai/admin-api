'use strict';

const validationCtrl = require('../../core/controllers/validation.controller');
const analyticsSchema = require('./schema/analytics.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateDateRange = function(req, res, next) {
  const payload = req.query;
  
  const payloadValidation = validationCtrl.validate(analyticsSchema.dateRangeSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedQuery = payloadValidation.value;
  return next(null);
};

exports.validateCharacterAnalyticsQuery = function(req, res, next) {
  const payload = req.query;
  
  const payloadValidation = validationCtrl.validate(analyticsSchema.characterAnalyticsSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedQuery = payloadValidation.value;
  return next(null);
};

exports.validateTemplateAnalyticsQuery = function(req, res, next) {
  const payload = req.query;
  
  const payloadValidation = validationCtrl.validate(analyticsSchema.templateAnalyticsSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedQuery = payloadValidation.value;
  return next(null);
};

exports.validateSignupAnalyticsQuery = function(req, res, next) {
  const payload = req.query;
  
  const payloadValidation = validationCtrl.validate(analyticsSchema.signupAnalyticsSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedQuery = payloadValidation.value;
  return next(null);
};

exports.validateLoginAnalyticsQuery = function(req, res, next) {
  const payload = req.query;
  
  const payloadValidation = validationCtrl.validate(analyticsSchema.loginAnalyticsSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedQuery = payloadValidation.value;
  return next(null);
};

exports.validatePurchasesAnalyticsQuery = function(req, res, next) {
  const payload = req.query;
  
  const payloadValidation = validationCtrl.validate(analyticsSchema.purchasesAnalyticsSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedQuery = payloadValidation.value;
  return next(null);
};

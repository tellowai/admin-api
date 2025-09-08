'use strict';

const validationCtrl = require('../../core/controllers/validation.controller');
const templateTagSchema = require('./schema/template.tag.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateCreateTemplateTagData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(templateTagSchema.createTemplateTagSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdateTemplateTagData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(templateTagSchema.updateTemplateTagSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateBulkArchiveTemplateTagsData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(templateTagSchema.bulkArchiveTemplateTagsSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateBulkUnarchiveTemplateTagsData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(templateTagSchema.bulkUnarchiveTemplateTagsSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

'use strict';

const validationCtrl = require('../../core/controllers/validation.controller');
const exploreSectionItemSchema = require('./schema/explore-section-item.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateAddSectionItemsData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(exploreSectionItemSchema.addSectionItemsSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateRemoveSectionItemsData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(exploreSectionItemSchema.removeSectionItemsSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateAddCollectionTemplatesData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(exploreSectionItemSchema.addCollectionTemplatesSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
}; 
'use strict';

const validationCtrl = require('../../core/controllers/validation.controller');
const roleSchema = require('./schema/role.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateCreateRoleData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(roleSchema.createRoleSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED') || 'Validation failed',
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdateRoleData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(roleSchema.updateRoleSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED') || 'Validation failed',
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateAssignPermissionsData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(roleSchema.assignPermissionsSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED') || 'Validation failed',
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdateRolePermissionsData = function(req, res, next) {
  const payload = req.body;
  
  const payloadValidation = validationCtrl.validate(roleSchema.updateRolePermissionsSchema, payload);
  
  if(payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED') || 'Validation failed',
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

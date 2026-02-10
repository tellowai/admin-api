'use strict';

const validationCtrl = require('../../core/controllers/validation.controller');
const languageSchema = require('./schema/language.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateCreateLanguageData = function (req, res, next) {
  const payload = req.body;

  const payloadValidation = validationCtrl.validate(languageSchema.createLanguageSchema, payload);

  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdateLanguageData = function (req, res, next) {
  const payload = req.body;

  const payloadValidation = validationCtrl.validate(languageSchema.updateLanguageSchema, payload);

  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdateLanguageStatus = function (req, res, next) {
  const payload = req.body;

  const payloadValidation = validationCtrl.validate(languageSchema.updateLanguageStatusSchema, payload);

  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

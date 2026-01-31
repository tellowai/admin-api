'use strict';

const validationCtrl = require('../../core/controllers/validation.controller');
const templateSchema = require('./schema/template.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateCreateTemplateData = function (req, res, next) {
  const payload = req.body;

  const payloadValidation = validationCtrl.validate(templateSchema.createTemplateSchema, payload);

  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdateTemplateData = function (req, res, next) {
  const payload = req.body;

  const payloadValidation = validationCtrl.validate(templateSchema.updateTemplateSchema, payload);

  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateBulkArchiveTemplatesData = function (req, res, next) {
  const payload = req.body;

  const payloadValidation = validationCtrl.validate(templateSchema.bulkArchiveTemplatesSchema, payload);

  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateBulkUnarchiveTemplatesData = function (req, res, next) {
  const payload = req.body;

  const payloadValidation = validationCtrl.validate(templateSchema.bulkUnarchiveTemplatesSchema, payload);

  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateUpdateTemplateStatusData = function (req, res, next) {
  const payload = req.body;

  const payloadValidation = validationCtrl.validate(templateSchema.updateTemplateStatusSchema, payload);

  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateBulkUpdateTemplatesStatusData = function (req, res, next) {
  const payload = req.body;

  const payloadValidation = validationCtrl.validate(templateSchema.bulkUpdateTemplatesStatusSchema, payload);

  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateExportTemplatesData = function (req, res, next) {
  const payload = req.body;

  const payloadValidation = validationCtrl.validate(templateSchema.exportTemplatesSchema, payload);

  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateImportTemplatesData = function (req, res, next) {
  const payload = req.body;

  const payloadValidation = validationCtrl.validate(templateSchema.importTemplatesSchema, payload);

  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateCreateDraftTemplateData = function (req, res, next) {
  const payload = req.body;

  const payloadValidation = validationCtrl.validate(templateSchema.createDraftTemplateSchema, payload);

  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};

exports.validateEnsureAiClipsData = function (req, res, next) {
  const payload = req.body;

  const payloadValidation = validationCtrl.validate(templateSchema.ensureAiClipsSchema, payload);

  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }

  req.validatedBody = payloadValidation.value;
  return next(null);
};
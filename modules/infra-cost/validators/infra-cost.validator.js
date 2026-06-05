'use strict';

const validationCtrl = require('../../core/controllers/validation.controller');
const infraCostSchema = require('./schema/infra-cost.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.validateUnitEconomicsQuery = function (req, res, next) {
  const payloadValidation = validationCtrl.validate(
    infraCostSchema.unitEconomicsSchema,
    req.query
  );
  if (payloadValidation.error && payloadValidation.error.length) {
    return res.status(HTTP_CODES.BAD_REQUEST).json({
      message: req.t('validation:VALIDATION_FAILED'),
      data: payloadValidation.error
    });
  }
  req.validatedQuery = payloadValidation.value;
  return next(null);
};

'use strict';

const validationCtrl = require('../../core/controllers/validation.controller');
const schema = require('./schema/sql-runner.schema');
const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

function validateQuery(schemaDef, source) {
  return function (req, res, next) {
    const payload = source === 'query' ? req.query : req.body;
    const payloadValidation = validationCtrl.validate(schemaDef, payload);

    if (payloadValidation.error && payloadValidation.error.length) {
      return res.status(HTTP_CODES.BAD_REQUEST).json({
        message: req.t('validation:VALIDATION_FAILED'),
        data: payloadValidation.error,
      });
    }

    if (source === 'query') {
      req.validatedQuery = payloadValidation.value;
    } else {
      req.validatedBody = payloadValidation.value;
    }
    return next();
  };
}

exports.validateListDatabases = validateQuery(schema.listDatabasesSchema, 'query');
exports.validateRunQuery = validateQuery(schema.runQuerySchema, 'body');

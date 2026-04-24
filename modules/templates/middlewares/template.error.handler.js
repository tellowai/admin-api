'use strict';

const i18next = require('i18next');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const logger = require('../../../config/lib/logger');

const MAX_SQL_LOG_LEN = 4000;

function buildTemplateErrorDiagnostics(error, context) {
  const sql = typeof error.sql === 'string' ? error.sql : undefined;
  const payload = {
    ...(context && { context }),
    message: error.message,
    originalMessage: error.originalMessage,
    sqlMessage: error.sqlMessage,
    code: error.code,
    errno: error.errno,
    sqlState: error.sqlState,
    sql: sql && sql.length > MAX_SQL_LOG_LEN ? `${sql.slice(0, MAX_SQL_LOG_LEN)}…` : sql,
    customErrCode: error.customErrCode,
    httpStatusCode: error.httpStatusCode
  };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
  return payload;
}

exports.handleTemplateErrors = function(error, res, context) {
  const diagnostics = buildTemplateErrorDiagnostics(error, context);
  console.error('[photobop-admin-api][templates]', JSON.stringify(diagnostics));
  if (error.stack) {
    console.error('[photobop-admin-api][templates] stack:', error.stack);
  }
  logger.error('Template API error', diagnostics);

  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.BAD_REQUEST).json({
    message: error.message || i18next.t('template:TEMPLATE_LIST_FAILED')
  });
};
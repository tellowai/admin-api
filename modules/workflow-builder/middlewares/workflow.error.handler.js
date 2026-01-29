'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const i18next = require('i18next');

exports.handleWorkflowErrors = function (error, res) {
  console.error('Workflow Error:', error);

  // MySQL specific errors
  if (error.code === 'ER_NO_SUCH_TABLE') {
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: i18next.t('workflow:TABLE_NOT_FOUND')
    });
  }

  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(HTTP_STATUS_CODES.CONFLICT).json({
      message: i18next.t('workflow:DUPLICATE_ENTRY')
    });
  }

  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: i18next.t('workflow:INVALID_REFERENCE')
    });
  }

  // Custom error codes
  if (error.code === 'VALIDATION_ERROR') {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      error: 'VALIDATION_ERROR',
      message: error.message,
      errors: error.errors || [],
      nodeErrors: error.nodeErrors || {}
    });
  }

  if (error.code === 'CONFLICT') {
    return res.status(HTTP_STATUS_CODES.CONFLICT).json({
      error: 'CONFLICT',
      message: error.message,
      serverHash: error.serverHash
    });
  }

  // Default error
  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
    message: error.message || i18next.t('workflow:OPERATION_FAILED')
  });
};

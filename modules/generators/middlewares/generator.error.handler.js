'use strict';

const i18next = require('i18next');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.handleGeneratorErrors = function(error, res) {
  if (error.code === 'INSUFFICIENT_CREDITS') {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: error.message,
      custom_error_code: 'INSUFFICIENT_CREDITS'
    });
  }

  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.BAD_REQUEST).json({
    message: error.message || i18next.t('generator:GENERATION_FAILED')
  });
};

exports.handleGeneratorListErrors = function(error, res) {
  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.BAD_REQUEST).json({
    message: error.message || i18next.t('generator:ERROR_FETCHING_GENERATIONS')
  });
};

exports.handleGeneratorDeleteErrors = function(error, res) {
  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.BAD_REQUEST).json({
    message: error.message || i18next.t('generator:ERROR_DELETING_GENERATION')
  });
}; 
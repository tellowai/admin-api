'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const logger = require('../../../config/lib/logger');

exports.handleCuratedOnboardingTemplateErrors = function(error, res) {
  logger.error('Curated onboarding template error:', {
    error: error.message,
    stack: error.stack
  });

  // Handle specific database errors
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(HTTP_STATUS_CODES.CONFLICT).json({
      message: 'Duplicate entry: Template ID already exists'
    });
  }

  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: 'Referenced template does not exist'
    });
  }

  // Handle general errors
  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
    message: error.message || 'An error occurred while processing the request'
  });
};


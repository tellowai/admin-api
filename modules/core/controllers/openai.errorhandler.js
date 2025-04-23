'use strict';

const i18next = require('i18next');

module.exports.handleOpenAIErrors = function(error) {
  // Rate limit errors
  if (error.code === 'rate_limit_exceeded') {
    return {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Rate limit exceeded, please try again later',
      status: 429
    };
  }

  // Authentication errors
  if (error.code === 'invalid_api_key' || error.code === 'invalid_request_error') {
    return {
      code: 'AUTH_ERROR',
      message: 'Authentication failed',
      status: 401
    };
  }

  // Model errors
  if (error.code === 'model_not_found') {
    return {
      code: 'MODEL_ERROR',
      message: 'Selected model is not available',
      status: 400
    };
  }

  // Context length errors
  if (error.code === 'context_length_exceeded') {
    return {
      code: 'CONTEXT_LENGTH_ERROR',
      message: 'Input too long for model context window',
      status: 400
    };
  }

  // Content filter errors
  if (error.code === 'content_filter') {
    return {
      code: 'CONTENT_FILTER_ERROR',
      message: 'Content was filtered due to safety concerns',
      status: 400
    };
  }

  // Service errors
  if (error.code === 'server_error') {
    return {
      code: 'SERVICE_ERROR',
      message: 'OpenAI service error',
      status: 503
    };
  }

  // Default error
  return {
    code: 'UNKNOWN_ERROR',
    message: error.message || 'An unknown error occurred',
    status: error.status || 500,
    details: error.response?.data || error.stack
  };
};

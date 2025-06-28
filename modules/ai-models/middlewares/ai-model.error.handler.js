'use strict';

const i18next = require('i18next');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.handleAiModelErrors = function(error, res) {
  if (error.code === 'ER_NO_SUCH_TABLE') {
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: i18next.t('ai_model:AI_MODEL_TABLE_NOT_FOUND')
    });
  }

  if (error.code === 'ER_BAD_FIELD_ERROR') {
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: i18next.t('ai_model:AI_MODEL_FIELD_ERROR')
    });
  }

  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
    message: error.message || i18next.t('ai_model:AI_MODEL_LIST_FAILED')
  });
};

exports.handleAiModelListErrors = function(error, res) {
  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
    message: error.message || i18next.t('ai_model:AI_MODEL_LIST_FAILED')
  });
}; 

exports.handleAiModelCreateErrors = function(error, res) {
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: i18next.t('ai_model:AI_MODEL_ALREADY_EXISTS')
    });
  }

  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: i18next.t('ai_model:PLATFORM_NOT_FOUND')
    });
  }

  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
    message: error.message || i18next.t('ai_model:AI_MODEL_CREATE_FAILED')
  });
};

exports.handleAiModelUpdateErrors = function(error, res) {
  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: i18next.t('ai_model:PLATFORM_NOT_FOUND')
    });
  }

  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
    message: error.message || i18next.t('ai_model:AI_MODEL_UPDATE_FAILED')
  });
}; 
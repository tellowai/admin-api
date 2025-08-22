'use strict';

const i18next = require('i18next');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.handleAiModelTagErrors = function(error, res) {
  if (error.code === 'ER_NO_SUCH_TABLE') {
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: i18next.t('ai_model_tag:AI_MODEL_TAG_TABLE_NOT_FOUND')
    });
  }

  if (error.code === 'ER_BAD_FIELD_ERROR') {
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: i18next.t('ai_model_tag:AI_MODEL_TAG_FIELD_ERROR')
    });
  }

  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
    message: error.message || i18next.t('ai_model_tag:AI_MODEL_TAG_OPERATION_FAILED')
  });
};

exports.handleAiModelTagListErrors = function(error, res) {
  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
    message: error.message || i18next.t('ai_model_tag:AI_MODEL_TAG_LIST_FAILED')
  });
};

exports.handleAiModelTagCreateErrors = function(error, res) {
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: i18next.t('ai_model_tag:TAG_CODE_ALREADY_EXISTS')
    });
  }

  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
    message: error.message || i18next.t('ai_model_tag:AI_MODEL_TAG_CREATE_FAILED')
  });
};

exports.handleAiModelTagUpdateErrors = function(error, res) {
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: i18next.t('ai_model_tag:TAG_CODE_ALREADY_EXISTS')
    });
  }

  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
    message: error.message || i18next.t('ai_model_tag:AI_MODEL_TAG_UPDATE_FAILED')
  });
};

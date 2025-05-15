'use strict';

const i18next = require('i18next');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.handleCharacterErrors = function(error, res) {
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: i18next.t('character:CHARACTER_NAME_ALREADY_EXISTS')
    });
  }

  if (error.code === 'ER_NO_REFERENCED_ROW_2' && error.originalMessage?.includes('user_id')) {
    return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
      message: i18next.t('user:USER_DOES_NOT_EXIST')
    });
  }

  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.BAD_REQUEST).json({
    message: error.message || i18next.t('character:CHARACTER_CREATION_FAILED')
  });
};

exports.handleCharacterListErrors = function(error, res) {
  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.BAD_REQUEST).json({
    message: error.message || i18next.t('character:CHARACTER_LIST_FAILED')
  });
}; 

exports.handleCharacterMediaErrors = function(error, res) {
  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.BAD_REQUEST).json({
    message: error.message || i18next.t('character:CHARACTER_MEDIA_FAILED')
  });
};

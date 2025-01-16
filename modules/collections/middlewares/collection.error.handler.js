'use strict';

const i18next = require('i18next');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.handleCollectionErrors = function(error, res) {
  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.BAD_REQUEST).json({
    message: error.message || i18next.t('collection:COLLECTION_LIST_FAILED')
  });
}; 
'use strict';

const i18next = require('i18next');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.handleNicheErrors = function(error, res) {
  return res.status(error.httpStatusCode || HTTP_STATUS_CODES.BAD_REQUEST).json({
    message: error.message || i18next.t('niche:NICHE_OPERATION_FAILED')
  });
};


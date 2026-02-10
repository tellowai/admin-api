'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.handleLanguageErrors = function (error, res) {
  return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
    message: 'An error occurred while processing the language request'
  });
};

'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.handleStudioToolErrors = function (error, res) {
  if (error && error.code === 'ER_DUP_ENTRY') {
    return res.status(HTTP_STATUS_CODES.CONFLICT).json({
      message: 'A tool with this key already exists',
    });
  }

  return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
    message: 'Something went wrong',
  });
};

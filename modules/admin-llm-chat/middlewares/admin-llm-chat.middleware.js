'use strict';

const CONSTANTS = require('../constants/admin-llm-chat.constants');
const ERROR_CODES = require('../constants/error.codes');
const HTTP = require('../../core/controllers/httpcodes.server.controller').CODES;

exports.requireEnabled = function requireEnabled(req, res, next) {
  if (!CONSTANTS.ENABLED) {
    const err = ERROR_CODES.ADMIN_LLM_CHAT_DISABLED;
    return res.status(err.httpStatus).json({ code: err.code, message: req.t(err.userMessage) || err.code });
  }
  return next();
};

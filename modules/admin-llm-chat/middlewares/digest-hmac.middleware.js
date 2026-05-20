'use strict';

const crypto = require('crypto');
const CONSTANTS = require('../constants/admin-llm-chat.constants');
const ERROR_CODES = require('../constants/error.codes');

exports.verifyDigestHmac = function verifyDigestHmac(req, res, next) {
  const secret = CONSTANTS.HMAC_SECRET;
  if (!secret) {
    return res.status(500).json({ code: 'HMAC_NOT_CONFIGURED' });
  }
  const timestamp = req.headers['x-admin-llm-chat-timestamp'];
  const signature = req.headers['x-admin-llm-chat-signature'];
  const nonce = req.headers['x-admin-llm-chat-nonce'];
  if (!timestamp || !signature) {
    const err = ERROR_CODES.HMAC_INVALID;
    return res.status(err.httpStatus).json({ code: err.code });
  }
  const skew = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (skew > CONSTANTS.HMAC_MAX_SKEW_SEC) {
    const err = ERROR_CODES.HMAC_INVALID;
    return res.status(err.httpStatus).json({ code: err.code });
  }
  const body = JSON.stringify(req.body || {});
  const payload = `${timestamp}.${nonce || ''}.${body}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (signature !== expected) {
    const err = ERROR_CODES.HMAC_INVALID;
    return res.status(err.httpStatus).json({ code: err.code });
  }
  return next();
};

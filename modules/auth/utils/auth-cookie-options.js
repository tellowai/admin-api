'use strict';

var config = require('../../../config/config');

/**
 * Build Set-Cookie options for auth tokens.
 * - Omits `domain` when config.cookieDomain is empty (empty Domain breaks some browsers).
 * - In production, sets Secure + SameSite so cross-subdomain XHR (admin.* → admin-api.*) is reliable.
 */
exports.forMaxAge = function forMaxAge(maxAgeMs) {
  var opts = {
    httpOnly: true,
    maxAge: maxAgeMs,
    path: '/'
  };

  if (config.cookieDomain) {
    opts.domain = config.cookieDomain;
  }

  var env = process.env.NODE_ENV || 'development';
  if (env === 'production') {
    opts.secure = true;
    opts.sameSite = 'lax';
  }

  return opts;
};

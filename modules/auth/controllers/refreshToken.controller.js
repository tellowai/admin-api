'use strict';
const crypto = require('crypto');


exports.generateToken = function (user, next) {

  crypto.randomBytes(32, function (err, buffer) {

    var refreshToken = buffer.toString('base64');

    next(refreshToken);
  });
};
'use strict';
const JWT = require('jsonwebtoken');
const config = require('../../../config/config')

exports.generateToken = function (user, next) {
  let payload = {
    userId : user.user_id,
    v : 'v1',
    isAdmin: true
  };

  if(user.pc_id) {
    payload.pcId = user.pc_id;
  }

  var jwtToken = JWT.sign(payload, 
  config.jwt.secret, { 
    expiresIn: config.jwt.expiresIn
  });

  next(jwtToken);
};

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const JWT = require('jsonwebtoken');
const config = require('../../../config/config')


exports.hasATRTTokens = function (req, res, next) {

  var accessToken = (req.cookies.accessToken) ? 
    req.cookies.accessToken : undefined;

  var refreshToken = (req.cookies.refreshToken) ? 
  req.cookies.refreshToken : undefined;

  var rsid = (req.cookies.rsid) ? 
  req.cookies.rsid : undefined;

  var sessIat = (req.cookies.sessIat) ? 
  req.cookies.sessIat : undefined;
  
  if((!accessToken || accessToken == null) || 
    (!refreshToken || refreshToken == null) || 
    (!rsid || rsid == null) || 
    (!sessIat || sessIat == null)) {

    const errMsg = req.t('UNAUTHORIZED');
    var responsePayload = {
      message : errMsg
    };

    return res.status(
      HTTP_STATUS_CODES.UNAUTHORIZED
    ).json(responsePayload);
  }

  next(null);
}

exports.hasRTTokenNRsid = function (req, res, next) {
  var refreshToken = (req.cookies.refreshToken) ? req.cookies.refreshToken : null;
  var rsid = (req.cookies.rsid) ? req.cookies.rsid : null;

  if (req.headers.authorization) {

    refreshToken = (req.body.refreshToken) ? req.body.refreshToken : undefined;

    rsid = (req.body.rsid) ? req.body.rsid : undefined;
  }
  
  if((!refreshToken || refreshToken == null) || 
    (!rsid || rsid == null) ) {

    const errMsg = req.t('FORBIDDEN');
    var responsePayload = {
      message : errMsg
    };

    return res.status(
      HTTP_STATUS_CODES.FORBIDDEN
    ).json(responsePayload);
  }

  next(null);
}

exports.isAuthorizedJWT = function (req, res, next) {

  var accessToken = (req.cookies.accessToken)? req.cookies.accessToken : null;
  
  var accessToken;

  if (req.headers.authorization) {

    var tokenArray = req.headers.authorization.split(' ');

    if (tokenArray[0] === 'Bearer') {
      
      accessToken = tokenArray[1] ? tokenArray[1] : undefined;
    }
  }

  JWT.verify(accessToken, config.jwt.secret, function (err, decodedData) {

    if(err) {

      const errMsg = req.t('UNAUTHORIZED');
      var responsePayload = {
        message : errMsg
      };

      return res.status(
        HTTP_STATUS_CODES.UNAUTHORIZED
      ).json(responsePayload);
    }

    req.user = decodedData;
    next(null);
  });
}

exports.verifyAndDecodeJWT = function (req, res, next) {
  
  var accessToken;

  if (req.headers.authorization) {

    var tokenArray = req.headers.authorization.split(' ');

    if (tokenArray[0] === 'Bearer') {
      
      accessToken = tokenArray[1] ? tokenArray[1] : undefined;
    }
  }

  if(accessToken) {
    JWT.verify(accessToken, config.jwt.secret, function (err, decodedData) {

      if(decodedData) {
  
        req.user = decodedData;
      }
    });
  }

  next(null);
}


exports.isAdminUser = function (req, res, next) {
  
  var accessToken = (req.cookies.accessToken)? req.cookies.accessToken : null;

  if (req.headers.authorization) {

    var tokenArray = req.headers.authorization.split(' ');

    if (tokenArray[0] === 'Bearer') {
      
      accessToken = tokenArray[1] ? tokenArray[1] : undefined;
    }
  }

  JWT.verify(accessToken, config.jwt.secret, function (err, decodedData) {

    if(err) {

      const errMsg = req.t('UNAUTHORIZED');
      var responsePayload = {
        message : errMsg
      };

      return res.status(
        HTTP_STATUS_CODES.UNAUTHORIZED
      ).json(responsePayload);
    }

    if(!decodedData.isAdmin) {

      const errMsg = req.t('NOT_AN_ADMIN');
      var responsePayload = {
        message : errMsg
      };

      return res.status(
        HTTP_STATUS_CODES.UNAUTHORIZED
      ).json(responsePayload);
    }

    req.user = decodedData;
    next(null);
  });
}

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const JWT = require('jsonwebtoken');
const config = require('../../../config/config')

function bearerTokenFromReq(req) {
  if (!req.headers.authorization) {
    return null;
  }
  var tokenArray = req.headers.authorization.split(' ');
  if (tokenArray[0] === 'Bearer' && tokenArray[1]) {
    return tokenArray[1];
  }
  return null;
}

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
  // Browser admin-ui sends the session via httpOnly cookie. Some clients also send
  // Authorization: Bearer. If both are present, we must not let a stale/non-admin Bearer
  // override a valid admin cookie (extensions, proxies, or leftover headers).
  var cookieTok = req.cookies.accessToken ? req.cookies.accessToken : null;
  var bearerTok = bearerTokenFromReq(req);

  var candidates = [];
  if (cookieTok) {
    candidates.push(cookieTok);
  }
  if (bearerTok && bearerTok !== cookieTok) {
    candidates.push(bearerTok);
  }

  if (candidates.length === 0) {
    const errMsg = req.t('UNAUTHORIZED');
    return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({ message: errMsg });
  }

  var sawValidJwtWithoutAdmin = false;
  var secret = config.jwt.secret;

  function tryCandidate(index) {
    if (index >= candidates.length) {
      const errMsg = sawValidJwtWithoutAdmin
        ? req.t('user:NOT_AN_ADMIN')
        : req.t('UNAUTHORIZED');
      return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({ message: errMsg });
    }

    JWT.verify(candidates[index], secret, function (err, decodedData) {
      if (err) {
        return tryCandidate(index + 1);
      }
      if (decodedData.isAdmin) {
        req.user = decodedData;
        return next(null);
      }
      sawValidJwtWithoutAdmin = true;
      return tryCandidate(index + 1);
    });
  }

  tryCandidate(0);
}

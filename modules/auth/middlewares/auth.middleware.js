const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const JWT = require('jsonwebtoken');
const config = require('../../../config/config');
const RbacModel = require('../models/rbac.model');

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

/** Cookie first, then Bearer if different — avoids stale Authorization overriding session cookies. */
function accessTokenCandidates(req) {
  var cookieTok = req.cookies.accessToken ? req.cookies.accessToken : null;
  var bearerTok = bearerTokenFromReq(req);
  var candidates = [];
  if (cookieTok) {
    candidates.push(cookieTok);
  }
  if (bearerTok && bearerTok !== cookieTok) {
    candidates.push(bearerTok);
  }
  return candidates;
}

function decodeFirstValidAccessJwt(candidates, secret) {
  for (var i = 0; i < candidates.length; i++) {
    try {
      return JWT.verify(candidates[i], secret);
    } catch (e) {
      // try next candidate
    }
  }
  return null;
}

function jwtClaimsIndicateAdmin(decoded) {
  if (decoded.isAdmin === true) {
    return true;
  }
  if (Array.isArray(decoded.roles) && decoded.roles.length > 0) {
    return true;
  }
  if (Array.isArray(decoded.permissions) && decoded.permissions.length > 0) {
    return true;
  }
  return false;
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
  var candidates = accessTokenCandidates(req);
  var secret = config.jwt.secret;

  if (candidates.length === 0) {
    const errMsg = req.t('UNAUTHORIZED');
    return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({ message: errMsg });
  }

  function tryCandidate(index) {
    if (index >= candidates.length) {
      const errMsg = req.t('UNAUTHORIZED');
      return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({ message: errMsg });
    }

    JWT.verify(candidates[index], secret, function (err, decodedData) {
      if (err) {
        return tryCandidate(index + 1);
      }
      req.user = decodedData;
      next(null);
    });
  }

  tryCandidate(0);
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


/**
 * Admin routes: valid JWT + (admin claim OR any role in DB).
 * JWT alone is not enough — generateToken() falls back to isAdmin:false when RBAC errors,
 * so we re-check MySQL when claims say non-admin (fixes stuck NOT_AN_ADMIN until refresh).
 */
exports.isAdminUser = function (req, res, next) {
  (async function () {
    var candidates = accessTokenCandidates(req);

    if (candidates.length === 0) {
      const errMsg = req.t('UNAUTHORIZED');
      return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({ message: errMsg });
    }

    var decoded = decodeFirstValidAccessJwt(candidates, config.jwt.secret);
    if (!decoded || !decoded.userId) {
      const errMsg = req.t('UNAUTHORIZED');
      return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({ message: errMsg });
    }

    var allowed = jwtClaimsIndicateAdmin(decoded);

    if (!allowed) {
      try {
        var rbac = await RbacModel.getUserRolesAndPermissions(decoded.userId, false);
        if (rbac.roles && rbac.roles.length > 0) {
          allowed = true;
          decoded = Object.assign({}, decoded, {
            isAdmin: true,
            roles: rbac.roles.map(function (r) { return r.role_name; }),
            permissions: rbac.permissions.map(function (p) { return p.permission_code; })
          });
        }
      } catch (rbacErr) {
        console.error('isAdminUser RBAC lookup failed:', rbacErr.message);
      }
    }

    if (!allowed) {
      return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
        message: req.t('user:NOT_AN_ADMIN'),
        code: 'NOT_AN_ADMIN'
      });
    }

    req.user = decoded;
    return next(null);
  })().catch(function (err) {
    return next(err);
  });
};

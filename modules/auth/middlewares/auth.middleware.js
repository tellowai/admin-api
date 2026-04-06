const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const JWT = require('jsonwebtoken');
const config = require('../../../config/config');
const RbacModel = require('../models/rbac.model');
const logger = require('../../../config/lib/logger');
const adminDebug = require('../utils/adminDebugStdout');

/** Log only cookie *names* from raw header — no values (avoids leaking tokens in stdout). */
function rawCookieHeaderNames(req) {
  var raw = req.headers && req.headers.cookie;
  if (!raw || typeof raw !== 'string') {
    return { present: false, names: [] };
  }
  var names = raw.split(';').map(function (part) {
    var eq = part.indexOf('=');
    return (eq === -1 ? part : part.slice(0, eq)).trim();
  }).filter(Boolean);
  return { present: true, nameCount: names.length, names: names.slice(0, 40) };
}

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

/** Ordered list of access tokens to try (cookie first, then Bearer if different). */
function buildAccessTokenAttempts(req) {
  var cookieTok = req.cookies && req.cookies.accessToken ? req.cookies.accessToken : null;
  var bearerTok = bearerTokenFromReq(req);
  var attempts = [];
  if (cookieTok) {
    attempts.push({ source: 'cookie', token: cookieTok });
  }
  if (bearerTok && bearerTok !== cookieTok) {
    attempts.push({ source: 'authorization_bearer', token: bearerTok });
  }
  return attempts;
}

function summarizeAuthHeader(req) {
  var h = req.headers && req.headers.authorization;
  if (!h) {
    return { present: false };
  }
  var parts = String(h).split(' ');
  return {
    present: true,
    scheme: parts[0] || null,
    hasSecondPart: Boolean(parts[1]),
    valueLength: String(h).length
  };
}

function summarizeJwtPayloadForLog(decoded) {
  if (!decoded || typeof decoded !== 'object') {
    return { decodedType: typeof decoded };
  }
  var roles = decoded.roles;
  var perms = decoded.permissions;
  var rolesInfo = {
    isArray: Array.isArray(roles),
    length: Array.isArray(roles) ? roles.length : null,
    sample: Array.isArray(roles) ? roles.slice(0, 8) : roles
  };
  var permsInfo = {
    isArray: Array.isArray(perms),
    length: Array.isArray(perms) ? perms.length : null
  };
  var nowSec = Math.floor(Date.now() / 1000);
  return {
    userId: decoded.userId,
    isAdminClaim: decoded.isAdmin,
    roles: rolesInfo,
    permissions: permsInfo,
    jwtIndicatesAdmin: jwtClaimsIndicateAdmin(decoded),
    iat: decoded.iat,
    exp: decoded.exp,
    nowSec: nowSec,
    expDeltaSec: typeof decoded.exp === 'number' ? decoded.exp - nowSec : null,
    payloadKeys: Object.keys(decoded).sort()
  };
}

/**
 * Try each token; collect verify errors for debugging (expired signature, wrong secret, etc.).
 * @returns {{ decoded: object|null, usedSource: string|null, usedIndex: number, jwtErrors: Array }}
 */
function tryDecodeAccessAttempts(attempts, secret) {
  var jwtErrors = [];
  for (var i = 0; i < attempts.length; i++) {
    try {
      return {
        decoded: JWT.verify(attempts[i].token, secret),
        usedSource: attempts[i].source,
        usedIndex: i,
        jwtErrors: jwtErrors
      };
    } catch (e) {
      jwtErrors.push({
        source: attempts[i].source,
        tokenLength: attempts[i].token ? attempts[i].token.length : 0,
        errName: e.name,
        errMessage: e.message
      });
    }
  }
  return { decoded: null, usedSource: null, usedIndex: -1, jwtErrors: jwtErrors };
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
    var attempts = buildAccessTokenAttempts(req);
    var candidates = attempts.map(function (a) { return a.token; });
    var baseCtx = {
      tag: 'isAdminUser',
      method: req.method,
      path: req.originalUrl || req.url,
      ip: req.ip,
      hasCookieAccessToken: Boolean(req.cookies && req.cookies.accessToken),
      authorizationHeader: summarizeAuthHeader(req),
      tokenAttemptCount: attempts.length,
      tokenSourcesAttempted: attempts.map(function (a) { return a.source; }),
      origin: req.headers && req.headers.origin,
      host: req.headers && req.headers.host,
      refererTail: req.headers && req.headers.referer
        ? String(req.headers.referer).slice(-120)
        : null,
      cookieParserKeys: Object.keys(req.cookies || {}).sort(),
      rawCookieHeaderNames: rawCookieHeaderNames(req),
      cookieDomainEnv: config.cookieDomain || ''
    };

    adminDebug.log('isAdminUser:incoming', baseCtx);

    if (candidates.length === 0) {
      logger.warn('isAdminUser: no access token candidates (UNAUTHORIZED)', baseCtx);
      try {
        console.warn('[admin-auth-middleware] isAdminUser: no access token candidates', JSON.stringify(baseCtx));
      } catch (e) {
        console.warn('[admin-auth-middleware] isAdminUser: no access token candidates (ctx stringify failed)');
      }
      const errMsg = req.t('UNAUTHORIZED');
      return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({ message: errMsg });
    }

    var decodeResult = tryDecodeAccessAttempts(attempts, config.jwt.secret);
    var decoded = decodeResult.decoded;
    if (!decoded || !decoded.userId) {
      var jwtFailCtx = Object.assign({}, baseCtx, {
        jwtUsedSource: decodeResult.usedSource,
        jwtUsedIndex: decodeResult.usedIndex,
        jwtVerifyErrors: decodeResult.jwtErrors,
        decodedHadUserId: Boolean(decoded && decoded.userId)
      });
      logger.warn('isAdminUser: JWT verify failed or missing userId (UNAUTHORIZED)', jwtFailCtx);
      try {
        console.warn('[admin-auth-middleware] isAdminUser: jwt_verify_failed', JSON.stringify(jwtFailCtx));
      } catch (e) {
        console.warn('[admin-auth-middleware] isAdminUser: jwt_verify_failed (ctx stringify failed)');
      }
      const errMsg = req.t('UNAUTHORIZED');
      return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({ message: errMsg });
    }

    var allowed = jwtClaimsIndicateAdmin(decoded);
    var adminGrantedViaRbac = false;
    var rbacCtx = {
      jwtUsedSource: decodeResult.usedSource,
      jwtUsedIndex: decodeResult.usedIndex,
      jwtClaimsSummary: summarizeJwtPayloadForLog(decoded),
      jwtHadPriorVerifyErrors: decodeResult.jwtErrors.length > 0,
      priorJwtErrors: decodeResult.jwtErrors
    };

    adminDebug.log('isAdminUser:jwt_decoded', {
      path: baseCtx.path,
      userId: decoded.userId,
      jwtIndicatesAdmin: allowed,
      usedSource: decodeResult.usedSource
    });

    if (!allowed) {
      try {
        var rbac = await RbacModel.getUserRolesAndPermissions(decoded.userId, false);
        rbacCtx.rbacLookupOk = true;
        rbacCtx.rbacRoleCount = rbac.roles ? rbac.roles.length : 0;
        rbacCtx.rbacPermissionCount = rbac.permissions ? rbac.permissions.length : 0;
        rbacCtx.rbacRoleNames = rbac.roles
          ? rbac.roles.map(function (r) { return r.role_name; }).slice(0, 20)
          : [];
        if (rbac.roles && rbac.roles.length > 0) {
          allowed = true;
          adminGrantedViaRbac = true;
          decoded = Object.assign({}, decoded, {
            isAdmin: true,
            roles: rbac.roles.map(function (r) { return r.role_name; }),
            permissions: rbac.permissions.map(function (p) { return p.permission_code; })
          });
          adminDebug.log('isAdminUser:rbac_recovered_admin', {
            path: baseCtx.path,
            userId: decoded.userId,
            rbacRoleCount: rbacCtx.rbacRoleCount,
            rbacRoleNames: rbacCtx.rbacRoleNames
          });
        } else {
          adminDebug.log('isAdminUser:rbac_empty_roles', {
            path: baseCtx.path,
            userId: decoded.userId
          });
        }
      } catch (rbacErr) {
        rbacCtx.rbacLookupOk = false;
        rbacCtx.rbacErrorName = rbacErr.name;
        rbacCtx.rbacErrorMessage = rbacErr.message;
        logger.error('isAdminUser: RBAC lookup threw', Object.assign({}, baseCtx, rbacCtx));
        adminDebug.warn('isAdminUser:rbac_lookup_threw', {
          path: baseCtx.path,
          userId: decoded.userId,
          errName: rbacErr.name,
          errMessage: rbacErr.message
        });
      }
    }

    if (!allowed) {
      var notAdminCtx = Object.assign({}, baseCtx, rbacCtx, {
        outcome: 'NOT_AN_ADMIN',
        hint: 'Check: stale JWT without roles; user not in admin_user_role; cookie vs Bearer mismatch; token expired (see jwtClaimsSummary.expDeltaSec)'
      });
      logger.warn('isAdminUser: NOT_AN_ADMIN — JWT has no admin signals and DB has no roles (or RBAC failed)', notAdminCtx);
      try {
        console.warn('[admin-auth-middleware] isAdminUser: NOT_AN_ADMIN', JSON.stringify(notAdminCtx));
      } catch (e) {
        console.warn('[admin-auth-middleware] isAdminUser: NOT_AN_ADMIN (ctx stringify failed)');
      }
      return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
        message: req.t('user:NOT_AN_ADMIN'),
        code: 'NOT_AN_ADMIN'
      });
    }

    req.user = decoded;
    adminDebug.log('isAdminUser:OK', {
      path: baseCtx.path,
      userId: decoded.userId,
      tokenSource: decodeResult.usedSource,
      adminGrantedViaRbac: adminGrantedViaRbac
    });
    return next(null);
  })().catch(function (err) {
    logger.error('isAdminUser: unexpected error', {
      tag: 'isAdminUser',
      errName: err.name,
      errMessage: err.message,
      path: req.originalUrl || req.url
    });
    adminDebug.warn('isAdminUser:unexpected_throw', {
      path: req.originalUrl || req.url,
      errName: err.name,
      errMessage: err.message
    });
    return next(err);
  });
};

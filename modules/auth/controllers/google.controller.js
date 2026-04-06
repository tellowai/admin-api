'use strict';
var passport = require('passport');
var TokensCtrl = require('../controllers/tokens.controller');
var HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
var config = require('../../../config/config');
var url = require('url');
const requestIp = require('request-ip');
var _ = require('lodash');
const cuid = require('cuid');
var async = require('async');
var AuthCtrl = require('../controllers/auth.controller');
var UserDbo = require('../dbo/user.dbo');
var AuthDbo = require('../dbo/auth.dbo');
var Parser = require('ua-parser-js');
var HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
var DeviceDetector = require("device-detector-js");
const { OAuth2Client } = require('google-auth-library');
const googleUtils = require('./passport/strategies/google.strategy');
const { createId } = require('@paralleldrive/cuid2');
var EmailCtrl = require('../../core/controllers/email.controller');
var emailConfig = require('../config/email.json');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const PROJECT_CONSTANTS = require('../constants/project.constants').CONSTANTS;
const moment = require('moment');
const CUSTOM_ERROR_CODES =
  require('../../core/controllers/customerrorcodes.server.controller').CODES;
const adminDebug = require('../utils/adminDebugStdout');

function registerOrRelinkGoogleProvider(resolvedUserId, userDataFromGoogle, next) {
  if (!userDataFromGoogle || !userDataFromGoogle.user_id_from_provider) {
    adminDebug.log('google.registerOrRelinkGoogleProvider:skip_no_sub', {
      resolvedUserId: resolvedUserId
    });
    return next(null);
  }
  var providerDataObj = {
    auth_provider_id: createId(),
    provider_type: 'google',
    user_id_from_provider: userDataFromGoogle.user_id_from_provider,
    user_id: resolvedUserId
  };
  adminDebug.log('google.registerOrRelinkGoogleProvider:start', {
    resolvedUserId: resolvedUserId,
    subTail: String(userDataFromGoogle.user_id_from_provider).slice(-8)
  });
  UserDbo.registerUserProvider(providerDataObj, function (err, rows) {
    if (err && err.customErrCode === CUSTOM_ERROR_CODES.RESOURCE_EXISTS) {
      adminDebug.log('google.registerOrRelinkGoogleProvider:dup_row_update_by_sub', {
        resolvedUserId: resolvedUserId,
        subTail: String(userDataFromGoogle.user_id_from_provider).slice(-8)
      });
      return UserDbo.updateGoogleProviderUserIdBySub(
        userDataFromGoogle.user_id_from_provider,
        resolvedUserId,
        next
      );
    }
    if (err) {
      adminDebug.warn('google.registerOrRelinkGoogleProvider:insert_failed', {
        resolvedUserId: resolvedUserId,
        message: err.message,
        customErrCode: err.customErrCode
      });
      return next(err);
    }
    adminDebug.log('google.registerOrRelinkGoogleProvider:new_provider_inserted', {
      resolvedUserId: resolvedUserId
    });
    next(null, rows);
  });
}

var ADMIN_OAUTH_LOG = '[admin-oauth]';

function adminOauthLog(step, payload) {
  var suffix = '';
  if (payload !== undefined && payload !== null) {
    try {
      suffix = ' ' + (typeof payload === 'object' ? JSON.stringify(payload) : String(payload));
    } catch (e) {
      suffix = ' [payload stringify failed]';
    }
  }
  console.log(ADMIN_OAUTH_LOG + ' ' + step + suffix);
}

function buildAuthCookieOpts(maxAgeMs) {
  var opts = { httpOnly: true, maxAge: maxAgeMs };
  if (config.cookieDomain) {
    opts.domain = config.cookieDomain;
  }
  return opts;
}

/**
  * @api {get} /oauth/google OAuth login with Google
  * @apiGroup Social Login
  *
  * @apiSuccess {String} accessToken Access token
  * @apiSuccess {String} refreshToken Refresh token
  * @apiSuccess {String} rsid session id for refresh token
  **/

exports.loginWithOAuthGoogle = function (req, res) {
  adminOauthLog('loginWithOAuthGoogle:authenticate_started', {
    path: req.path,
    originalUrl: req.originalUrl,
    clientDomainRedirectBase: config.clientDomainUrl
  });

  passport.authenticate('google', function (err, userData) {

    adminOauthLog('loginWithOAuthGoogle:passport_callback', {
      hasErr: Boolean(err),
      errName: err && err.name,
      hasUserData: Boolean(userData),
      existingUserRows: userData && userData.existingUserData ? userData.existingUserData.length : 0,
      googleEmail: userData && userData.userDataFromGoogle && userData.userDataFromGoogle.email
    });

    if (err) {

      var responsePayload = {
        message: req.t('facebook:AUTH_CODE_ALREADY_USED')
      };

      if (err.name && err.name == 'TokenError') {
        adminOauthLog('loginWithOAuthGoogle:response', { status: HTTP_CODES.BAD_REQUEST, branch: 'TokenError' });
        return res.status(
          HTTP_CODES.BAD_REQUEST
        ).json(responsePayload);
      } else if (err.name && err.name == 'UserVerifyError') {
        var query = { error: err.name };

        adminOauthLog('loginWithOAuthGoogle:response', { status: HTTP_CODES.UNAUTHORIZED, branch: 'UserVerifyError_redirect' });
        return res.status(
          HTTP_CODES.UNAUTHORIZED
        ).redirect(url.format({
          pathname: config.creatorsWebDomainLoginUrl,
          query: query
        }));
      } else {

        var responsePayload = {
          message: err
        };

        adminOauthLog('loginWithOAuthGoogle:response', { status: HTTP_CODES.BAD_REQUEST, branch: 'generic_err' });
        return res.status(
          HTTP_CODES.BAD_REQUEST
        ).json(responsePayload);
      }
    }

    if (!userData) {
      adminOauthLog('loginWithOAuthGoogle:response', { status: HTTP_STATUS_CODES.UNAUTHORIZED, branch: 'no_userData' });
      return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
        message: req.t('user:AUTHENTICATION_FAILED') || 'Authentication failed'
      });
    }

    const clientIp = requestIp.getClientIp(req);

    function finishAdminOAuthGoogle(userData) {

      function runAdminJwtRedirectForUser(resolvedUserId, sourceTag) {
        adminOauthLog('runAdminJwtRedirectForUser:start', {
          sourceTag: sourceTag || 'unknown',
          resolvedUserId: resolvedUserId,
          googleSub: userData.userDataFromGoogle && userData.userDataFromGoogle.user_id_from_provider,
          email: userData.userDataFromGoogle && userData.userDataFromGoogle.email,
          cookieDomainConfigured: Boolean(config.cookieDomain)
        });

        registerOrRelinkGoogleProvider(resolvedUserId, userData.userDataFromGoogle, function (linkErr) {
          if (linkErr) {
            adminOauthLog('runAdminJwtRedirectForUser:provider_link_failed', {
              message: linkErr.message,
              httpStatusCode: linkErr.httpStatusCode
            });
            return res.status(linkErr.httpStatusCode || HTTP_STATUS_CODES.BAD_REQUEST).json({
              message: linkErr.message
            });
          }

          UserDbo.getAdminUserRoleByUserId(resolvedUserId, function (err, adminUserData) {
            if (err) {
              adminOauthLog('runAdminJwtRedirectForUser:admin_role_db_error', { message: err.message });
              return res.status(err.httpStatusCode).json({ message: err.message });
            }

            if (!adminUserData) {
              adminOauthLog('runAdminJwtRedirectForUser:not_admin_in_db', { resolvedUserId });
              return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
                message: req.t('user:NOT_AN_ADMIN'),
                code: 'NOT_AN_ADMIN'
              });
            }

            var userDataForJWT = {
              user_id: resolvedUserId
            };

            TokensCtrl.generateJWTnRefreshTokens(userDataForJWT, function (err, tokenData) {

              if (err) {
                adminOauthLog('runAdminJwtRedirectForUser:token_generation_failed', { message: err && err.message });
                const errMsg = req.t('SOMETHING_WENT_WRONG_PLEASE_TRY_AGAIN');
                return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: errMsg });
              }

              var userLoginDeviceData = getLoggedInDeviceData(req.headers['user-agent'], req.body);
              userLoginDeviceData.userId = resolvedUserId;
              userLoginDeviceData.tokenData = tokenData;
              userLoginDeviceData.clientIp = clientIp;

              AuthCtrl.registerDeviceNSaveLoginHistory(userLoginDeviceData, function (err, loginDeviceSavedResp) {
                // best-effort
              });

              kafkaCtrl.sendMessage(
                TOPICS.AUTH_EVENT_LOGGED_IN,
                [{
                  value: {
                    userId: resolvedUserId,
                    provider: 'google'
                  }
                }],
                'logged_in'
              );

              adminOauthLog('runAdminJwtRedirectForUser:set_cookies_and_redirect', {
                redirectTo: config.clientDomainUrl + '/',
                jwtUserId: resolvedUserId
              });

              return res.cookie('accessToken', tokenData.jwtToken, buildAuthCookieOpts(config.jwt.expiresInMilliseconds)
              ).cookie('refreshToken', tokenData.encryptedRT, buildAuthCookieOpts(config.refreshToken.expiresInMilliseconds)
              ).cookie('rsid', tokenData.redisRefreshTokenObj.rsid, buildAuthCookieOpts(config.refreshToken.expiresInMilliseconds)
              ).cookie('sessIat', moment().unix(), buildAuthCookieOpts(config.jwt.expiresInMilliseconds)
              ).status(
                HTTP_STATUS_CODES.OK
              ).redirect(config.clientDomainUrl + "/");
            });
          });
        });
      }

      if (!userData.existingUserData.length) {
        adminOauthLog('finishAdminOAuthGoogle:abort_empty_existingUserData', {});
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: req.t('user:NOT_AN_ADMIN'),
          code: 'NOT_AN_ADMIN'
        });
      }

      var userEmail = userData.userDataFromGoogle.email;
      var providerUserId = userData.existingUserData[0].user_id;

      adminOauthLog('finishAdminOAuthGoogle:entered', {
        userEmail: userEmail,
        providerUserId: providerUserId,
        existingUserDataLen: userData.existingUserData.length
      });

      if (!providerUserId) {
        adminOauthLog('finishAdminOAuthGoogle:abort_missing_providerUserId', {});
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: req.t('user:USER_NOT_FOUND')
        });
      }

      var options = {
        select: ['email', 'user_id']
      };

      AuthDbo.getUserDataByEmailFromMaster(userEmail, options, function (err, loggedInUserData) {

        if (err) {
          adminOauthLog('finishAdminOAuthGoogle:master_email_lookup_error', { message: err.message });
          return res.status(err.httpStatusCode).json({ message: err.message });
        }

        adminOauthLog('finishAdminOAuthGoogle:master_email_lookup_ok', {
          rowCount: loggedInUserData.length,
          userIds: loggedInUserData.map(function (r) { return r.user_id; })
        });

        if (loggedInUserData.length > 1) {
          adminOauthLog('finishAdminOAuthGoogle:response_conflict_multiple_email_rows', { email: userEmail });
          return res.status(HTTP_STATUS_CODES.CONFLICT).json({
            message: req.t('user:MULTIPLE_ACCOUNTS_REGISTERED_WITH_SAME_EMAIL'),
            email: userEmail
          });
        }

        if (loggedInUserData.length === 1) {
          adminOauthLog('finishAdminOAuthGoogle:branch_primary_user_row', {
            resolvedUserId: loggedInUserData[0].user_id
          });
          return runAdminJwtRedirectForUser(loggedInUserData[0].user_id, 'primary_email_on_user_table');
        }

        adminOauthLog('finishAdminOAuthGoogle:branch_secondary_email_path', {
          providerUserId: providerUserId,
          userEmail: userEmail
        });

        async.waterfall([
          function registerSecondaryEmailStep(next) {

            var rawDataForSecondayEmail = {
              email: userEmail,
              user_id: providerUserId
            };

            var secondaryEmailObj = getSecondaryEmailData(rawDataForSecondayEmail);

            UserDbo.registerSecondaryEmail(secondaryEmailObj, function (err, registeredUserProvider) {
              if (err && err.customErrCode === CUSTOM_ERROR_CODES.RESOURCE_EXISTS) {
                adminOauthLog('finishAdminOAuthGoogle:secondary_insert_duplicate_recover_via_master_email', {
                  email: userEmail,
                  originalMessage: err.originalMessage
                });
                return AuthDbo.getUserDataByEmailFromMaster(userEmail, options, function (e2, rows) {
                  if (e2) {
                    adminOauthLog('finishAdminOAuthGoogle:dup_recovery_master_lookup_err', { message: e2.message });
                    return res.status(e2.httpStatusCode).json({ message: e2.message });
                  }
                  if (rows && rows.length === 1) {
                    adminOauthLog('finishAdminOAuthGoogle:dup_recovery_found_user', { userId: rows[0].user_id });
                    return runAdminJwtRedirectForUser(rows[0].user_id, 'dup_recovery_to_primary_email_user');
                  }
                  adminOauthLog('finishAdminOAuthGoogle:dup_recovery_no_single_row', { rowCount: rows ? rows.length : 0 });
                  return res.status(err.httpStatusCode).json({ message: err.message });
                });
              }
              if (err) {
                adminOauthLog('finishAdminOAuthGoogle:secondary_insert_error', { message: err.message });
                return res.status(err.httpStatusCode).json({ message: err.message });
              }
              adminOauthLog('finishAdminOAuthGoogle:secondary_insert_ok', { providerUserId: providerUserId });
              return next(null);
            });
          }, function adminAndTokensOnProviderUser(next) {

            UserDbo.getAdminUserRoleByUserId(providerUserId, function (err, adminUserData) {
              if (err) {
                adminOauthLog('finishAdminOAuthGoogle:secondary_path_admin_role_db_error', { message: err.message });
                var errPayload = { message: err.message };
                return res.status(err.httpStatusCode).json(errPayload);
              }

              if (!adminUserData) {
                adminOauthLog('finishAdminOAuthGoogle:secondary_path_not_admin', { providerUserId: providerUserId });
                return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
                  message: req.t('user:NOT_AN_ADMIN'),
                  code: 'NOT_AN_ADMIN'
                });
              }

              var userDataForJWT = {
                user_id: providerUserId
              };

              TokensCtrl.generateJWTnRefreshTokens(userDataForJWT, function (err, tokenData) {

                if (err) {
                  const errMsg = req.t('SOMETHING_WENT_WRONG_PLEASE_TRY_AGAIN');
                  adminOauthLog('finishAdminOAuthGoogle:secondary_path_token_err', { message: err && err.message });
                  return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: errMsg });
                }

                var userLoginDeviceData = getLoggedInDeviceData(req.headers['user-agent'], req.body);
                userLoginDeviceData.userId = providerUserId;
                userLoginDeviceData.tokenData = tokenData;
                userLoginDeviceData.clientIp = clientIp;

                AuthCtrl.registerDeviceNSaveLoginHistory(userLoginDeviceData, function (err, loginDeviceSavedResp) {
                  // best-effort
                });

                adminOauthLog('finishAdminOAuthGoogle:secondary_path_redirect', { providerUserId: providerUserId });

                return res.cookie('accessToken', tokenData.jwtToken, buildAuthCookieOpts(config.jwt.expiresInMilliseconds)
                ).cookie('refreshToken', tokenData.encryptedRT, buildAuthCookieOpts(config.refreshToken.expiresInMilliseconds)
                ).cookie('rsid', tokenData.redisRefreshTokenObj.rsid, buildAuthCookieOpts(config.refreshToken.expiresInMilliseconds)
                ).cookie('sessIat', moment().unix(), buildAuthCookieOpts(config.jwt.expiresInMilliseconds)
                ).status(
                  HTTP_STATUS_CODES.OK
                ).redirect(config.clientDomainUrl + "/");
              });
            });
          }
        ], function (errObj, tokenPayload) {

          if (errObj) {
            adminOauthLog('finishAdminOAuthGoogle:waterfall_final_error', { message: errObj.message });
            return res.status(
              errObj.httpStatusCode
            ).json({
              message: errObj.message
            });
          }

          adminOauthLog('finishAdminOAuthGoogle:waterfall_final_ok_json', {});
          res.status(
            HTTP_STATUS_CODES.OK
          ).json(tokenPayload);
        });
      });
    }

    if (!userData.userDataFromGoogle || !userData.userDataFromGoogle.email) {
      adminOauthLog('loginWithOAuthGoogle:response', { branch: 'missing_google_email' });
      return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
        message: req.t('user:AUTHENTICATION_FAILED') || 'Authentication failed'
      });
    }

    if (!userData.existingUserData.length) {
      adminOauthLog('loginWithOAuthGoogle:provider_miss_email_precheck_master', {
        email: userData.userDataFromGoogle.email
      });
      AuthDbo.getUserDataByEmailFromMaster(
        userData.userDataFromGoogle.email,
        { select: ['email', 'user_id'] },
        function (emailErr, emailRows) {
          adminOauthLog('loginWithOAuthGoogle:email_precheck_master_result', {
            err: Boolean(emailErr),
            rowCount: emailRows ? emailRows.length : 0
          });
          if (emailErr) {
            return res.status(emailErr.httpStatusCode).json({ message: emailErr.message });
          }
          if (emailRows.length > 1) {
            adminOauthLog('loginWithOAuthGoogle:response', { branch: 'email_conflict' });
            return res.status(HTTP_STATUS_CODES.CONFLICT).json({
              message: req.t('user:MULTIPLE_ACCOUNTS_REGISTERED_WITH_SAME_EMAIL'),
              email: userData.userDataFromGoogle.email
            });
          }
          if (emailRows.length === 1) {
            userData.existingUserData = emailRows;
            adminOauthLog('loginWithOAuthGoogle:precheck_set_existing_from_email', { userId: emailRows[0].user_id });
            return finishAdminOAuthGoogle(userData);
          }
          adminOauthLog('loginWithOAuthGoogle:response', { branch: 'NOT_AN_ADMIN_no_user_row_for_email' });
          return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
            message: req.t('user:NOT_AN_ADMIN'),
            code: 'NOT_AN_ADMIN'
          });
        }
      );
    } else {
      adminOauthLog('loginWithOAuthGoogle:provider_hit_existing_rows', {
        count: userData.existingUserData.length,
        userId: userData.existingUserData[0] && userData.existingUserData[0].user_id
      });
      finishAdminOAuthGoogle(userData);
    }
  })(req, res);
};

/**
  * @api {post} /auth/signin/google Login with Google auth code / access token
  * @apiGroup Social Login
  *
  * @apiBody {String} credential Google credential code / access token
  * 
  * @apiSuccess {String} accessToken Access token
  * @apiSuccess {String} refreshToken Refresh token
  * @apiSuccess {String} rsid session id for refresh token
  **/

exports.loginWithGoogleToken = function (req, res) {
  const CLIENT_ID = config.google.clientID;
  const IOS_CLIENT_ID = config.google.ios.clientID;
  const ANDROID_CLIENT_ID = config.google.android.clientID;
  const client = new OAuth2Client(CLIENT_ID);
  const token = req.body.credential;
  let userData = {};
  const clientIp = requestIp.getClientIp(req);


  async.waterfall([
    function getDataFromGoogle(next) {
      client.verifyIdToken({
        idToken: token,
        audience: [CLIENT_ID, IOS_CLIENT_ID, ANDROID_CLIENT_ID],
      }, (err, ticket) => {

        if (err) {

          var responsePayload = {
            message: req.t('SOMETHING_WENT_WRONG_PLEASE_TRY_AGAIN')
          };

          return res.status(
            HTTP_CODES.BAD_REQUEST
          ).json(responsePayload);
        } else {
          const payload = ticket.getPayload();

          // If required, you can also extract other details like name, picture, etc.
          next(null, payload);
        }
      });
    }, function restructureGoogleData(payload, next) {

      const userDataFromGoogle = googleUtils.restructureGoogleData(payload);

      userData.userDataFromGoogle = userDataFromGoogle;

      next(null, userData);
    },
    function checkNoOfAccountsInDb(userData, next) {
      let userDataFromGoogle = userData.userDataFromGoogle;

      adminOauthLog('loginWithGoogleToken:master_email_lookup', { email: userDataFromGoogle.email });

      AuthDbo.getUserDataByEmailFromMaster(
        userDataFromGoogle.email, { select: ['email', 'user_id'] }, function (err, matchingAcocunts) {

          if (err) {

            adminOauthLog('loginWithGoogleToken:master_email_lookup_err', { message: err.message });
            return next(err);
          }

          adminOauthLog('loginWithGoogleToken:master_email_lookup_ok', {
            rowCount: matchingAcocunts.length
          });

          if (matchingAcocunts.length > 1) {
            return res.status(
              HTTP_STATUS_CODES.CONFLICT
            ).json({
              message: req.t('user:MULTIPLE_ACCOUNTS_REGISTERED_WITH_SAME_EMAIL'),
              email: userDataFromGoogle.email
            });
          }

          userData.existingUserData = matchingAcocunts;


          next(null, userData);
        });
    },
    // function checkInDb(userData, next) {
    //   let userDataFromGoogle = userData.userDataFromGoogle;

    //   AuthDbo.getUserDataByProviderBackedUserId(
    //     userDataFromGoogle.user_id_from_provider, function (err, existingUserData) {

    //     if(err) {

    //       return next(err);
    //     }

    //     userData.existingUserData = existingUserData;

    //     next(null, userData);
    //   });
    // }, 
    function login(userData, next) {
      if (!userData.existingUserData.length) {
        var userObjForRegistration = getRegistrationUserObjFromRawData(userData.userDataFromGoogle);
        var providerObjForRegistration = getRegistrationProviderObjFromRawData(userData.userDataFromGoogle);

        async.waterfall([
          function registerUser(callback) {

            UserDbo.registerUser(userObjForRegistration, function (err, registeredUserObj) {

              if (err) {

                var responsePayload = {
                  message: err.message
                };

                return res.status(
                  err.httpStatusCode
                ).json(responsePayload);
              }

              // publish kafka event
              kafkaCtrl.sendMessage(
                TOPICS.AUTH_EVENT_SIGNED_UP,
                [{
                  value: {
                    userId: userObjForRegistration.user_id,
                    provider: 'google'
                  }
                }],
                'signed_up'
              );

              kafkaCtrl.sendMessage(
                TOPICS.PROJECT_COMMAND_CREATE_DEFAULT_PROJECT,
                [{
                  value: {
                    userId: userObjForRegistration.user_id,
                    projectName: PROJECT_CONSTANTS.DEFAULT_PROJECT_NAME
                  }
                }],
                'create_default_project'
              );

              return callback(null, registeredUserObj);
            });
          },
          function registerUserProvider(registeredUserObj, callback) {

            UserDbo.registerUserProvider(providerObjForRegistration, function (err, registeredUserProvider) {

              if (err) {

                var responsePayload = {
                  message: err.message
                };

                return res.status(
                  err.httpStatusCode
                ).json(responsePayload);
              }

              var finalRegisteredUserObj = {
                registeredUserObj: userObjForRegistration,
                registeredUserProvider: providerObjForRegistration
              }

              return callback(null, finalRegisteredUserObj);
            });
          },
          function generateLoginTokens(finalRegisteredUserObj, callback) {

            var userDataForJWT = {
              user_id: finalRegisteredUserObj.registeredUserObj.user_id
            };
            var userId = finalRegisteredUserObj.registeredUserObj.user_id;

            TokensCtrl.generateJWTnRefreshTokens(userDataForJWT, async function (err, tokenData) {

              if (err) {

                const errMsg = req.t('SOMETHING_WENT_WRONG_PLEASE_TRY_AGAIN');
                var responsePayload = {
                  message: errMsg
                };

                return res.status(
                  err.httpStatusCode
                ).json(responsePayload);
              } else {

                var userLoginDeviceData = getLoggedInDeviceData(req.headers['user-agent'], req.body);
                userLoginDeviceData.userId = userId;
                userLoginDeviceData.tokenData = tokenData;
                userLoginDeviceData.clientIp = clientIp;

                AuthCtrl.registerDeviceNSaveLoginHistory(userLoginDeviceData, function (err, loginDeviceSavedResp) {

                  // DO NOT BOTHER IF THERE IS ANY ERROR FROM DB. WE ARE TRYING TO INSERT DEVICE DATA AND 
                  // LOGIN HISTORY DATA HERE. RESPONSE IS NOT NEEDED
                });

                if (finalRegisteredUserObj.registeredUserObj.username && finalRegisteredUserObj.registeredUserObj.email) {
                  const emailVariables = {
                    username: "@" + finalRegisteredUserObj.registeredUserObj.username,
                  };

                  await sendWelcomeEmail(finalRegisteredUserObj.registeredUserObj.email, emailVariables);
                }

                var tokenPayload = {
                  firstTimeUser: true,
                  accessToken: tokenData.jwtToken,
                  refreshToken: tokenData.encryptedRT,
                  rsid: tokenData.redisRefreshTokenObj.rsid,
                  username: finalRegisteredUserObj.registeredUserObj.username,
                  displayName: finalRegisteredUserObj.registeredUserObj.display_name
                };

                return callback(null, tokenPayload);
              }
            });
          }
        ], function (errObj, finalTokenObject) {

          if (errObj) {

            return res.status(
              errObj.httpStatusCode
            ).json({
              message: errObj.message
            });
          }

          res.status(
            HTTP_STATUS_CODES.CREATED
          ).json(finalTokenObject);
        });
      } else {

        // If user exists 
        // a) check if email provided from fb and in our db are same
        // b) if same --> login
        // c) if not same --> add this email in our db as secondary email
        // d) then login

        var userEmail = userData.userDataFromGoogle.email;
        var userId = userData.existingUserData[0].user_id;
        var options = {
          select: ['email', 'user_id']
        };

        adminOauthLog('loginWithGoogleToken:existing_user_admin_gate', { userId: userId, email: userEmail });

        UserDbo.getAdminUserRoleByUserId(userId, function (err, adminUserData) {
          if (err) {
            adminOauthLog('loginWithGoogleToken:admin_gate_db_err', { message: err.message });
            return res.status(err.httpStatusCode).json({ message: err.message });
          }

          if (!adminUserData) {
            adminOauthLog('loginWithGoogleToken:not_admin', { userId: userId });
            return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
              message: req.t('user:NOT_AN_ADMIN'),
              code: 'NOT_AN_ADMIN'
            });
          }

          var userDataForJWT = {
            user_id: userId
          };

          TokensCtrl.generateJWTnRefreshTokens(userDataForJWT, function (err, tokenData) {

            if (err) {

              const errMsg = req.t('SOMETHING_WENT_WRONG_PLEASE_TRY_AGAIN');
              var responsePayload = {
                message: errMsg
              };

              return res.status(
                HTTP_STATUS_CODES.BAD_REQUEST
              ).json(responsePayload);
            }

            var userLoginDeviceData = getLoggedInDeviceData(req.headers['user-agent'], req.body);
            userLoginDeviceData.userId = userId;
            userLoginDeviceData.tokenData = tokenData;
            userLoginDeviceData.clientIp = clientIp;

            AuthCtrl.registerDeviceNSaveLoginHistory(userLoginDeviceData, function (err, loginDeviceSavedResp) {

              // DO NOT BOTHER IF THERE IS ANY ERROR FROM DB. WE ARE TRYING TO INSERT DEVICE DATA AND 
              // LOGIN HISTORY DATA HERE. RESPONSE IS NOT NEEDED
            });

            kafkaCtrl.sendMessage(
              TOPICS.AUTH_EVENT_LOGGED_IN,
              [{
                value: {
                  userId: userId,
                  provider: 'google'
                }
              }],
              'logged_in'
            );

            var responsePayload = {
              accessToken: tokenData.jwtToken,
              refreshToken: tokenData.encryptedRT,
              rsid: tokenData.redisRefreshTokenObj.rsid,
              username: userData.existingUserData[0].username
            };

            return res.status(
              HTTP_STATUS_CODES.OK
            ).json(responsePayload);
          });
        });
      }
    }
  ], function (errObj, finalTokenObject) {

    if (errObj) {

      return res.status(
        errObj.httpStatusCode
      ).json({
        message: errObj.message
      });
    }

    return res.status(
      HTTP_STATUS_CODES.OK
    ).json(finalTokenObject);
  });
}

function getRegistrationUserObjFromRawData(userDataFromProvider) {

  var userObj = _.cloneDeep(userDataFromProvider);
  delete userObj.user_id_from_provider;
  userObj.is_email_verified = true;

  return userObj;
}

function getRegistrationProviderObjFromRawData(userDataFromProvider) {

  var providerDataObj = {
    auth_provider_id: createId(),
    provider_type: 'google',
    user_id_from_provider: userDataFromProvider.user_id_from_provider,
    user_id: userDataFromProvider.user_id
  }

  return providerDataObj;
}

function getSecondaryEmailData(rawData) {

  var secondaryEmailObj = {
    user_se_id: createId(),
    email: rawData.email,
    user_id: rawData.user_id
  }

  return secondaryEmailObj;
}

function getLoggedInDeviceData(userAgenet, payload) {

  var userLoginDeviceData = {};

  if (payload.deviceData) {

    var deviceData = payload.deviceData;

    userLoginDeviceData.device = {
      model: deviceData.model,
      brand: deviceData.brand
    }

    userLoginDeviceData.os = {
      os: deviceData.os,
      os_version: deviceData.os_version
    }

    userLoginDeviceData.client = {
      client_type: deviceData.client_type,
      client_version: deviceData.client_version,
      client_major: deviceData.client_major,
      client_ua: deviceData.client_ua,
      client_engine: deviceData.client_engine
    }
  } else {

    var ua = Parser(userAgenet);

    var loginClientDeviceData = {
      brand: ua.device.vendor,
      model: ua.device.model
    };

    var loginClientUserDeviceData = {
      os: ua.os.name,
      os_version: ua.os.version
    };

    var loginClientData = {
      client_type: 'browser',
      client_version: ua.browser.version,
      client_major: ua.browser.major,
      client_ua: ua.ua,
      client_engine: ua.engine
    };

    if (!loginClientDeviceData.brand || loginClientDeviceData.brand == '') {

      var DD = new DeviceDetector();
      var device = DD.parse(ua.ua);

      if (device.device && device.device.brand) {
        loginClientDeviceData.brand = device.device.brand
      }

      if (ua.os.name && ua.os.name.toLocaleLowerCase() == 'mac os') {

        loginClientDeviceData.model = "MacBook";
      }
    }

    if (!loginClientDeviceData.model || loginClientDeviceData.model == '') {

      var DD = new DeviceDetector();
      var device = DD.parse(ua.ua);

      if (device.device && device.device.model) {
        loginClientDeviceData.model = device.device.model
      }
    }

    userLoginDeviceData = {
      device: loginClientDeviceData,
      os: loginClientUserDeviceData,
      client: loginClientData
    }
  }

  return userLoginDeviceData;
}

const sendWelcomeEmail = async (email, emailVariables) => {
  const templateName = "welcome to suprstar";
  const emailSubject = emailConfig.WELCOME_EMAIL_SUBJECT;

  return await EmailCtrl.sendEmailWithTemplateName(email, emailSubject, emailVariables, templateName);
}

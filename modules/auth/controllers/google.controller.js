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
var config = require('../../../config/config');
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


/**
  * @api {get} /oauth/google OAuth login with Google
  * @apiGroup Social Login
  *
  * @apiSuccess {String} accessToken Access token
  * @apiSuccess {String} refreshToken Refresh token
  * @apiSuccess {String} rsid session id for refresh token
  **/

exports.loginWithOAuthGoogle = function (req, res) {
  passport.authenticate('google', function (err, userData) {

    if (err) {

      const errMsg = req.t('SOMETHING_WENT_WRONG') + ' ' +
        req.t('PLEASE_TRY_AGAIN');

      var responsePayload = {
        message: req.t('facebook:AUTH_CODE_ALREADY_USED')
      };

      if (err.name && err.name == 'TokenError') {
        return res.status(
          HTTP_CODES.BAD_REQUEST
        ).json(responsePayload);
      } else if (err.name && err.name == 'UserVerifyError') {
        var query = { error: err.name }

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

        return res.status(
          HTTP_CODES.BAD_REQUEST
        ).json(responsePayload);
      }
    }

    if (!userData) {
      return res.status(HTTP_STATUS_CODES.UNAUTHORIZED).json({
        message: req.t('user:AUTHENTICATION_FAILED') || 'Authentication failed'
      });
    }

    const clientIp = requestIp.getClientIp(req);

    // If user doesn't exist --> register user --> then login
    if (!userData.existingUserData.length) {
      return res.status(
        HTTP_STATUS_CODES.BAD_REQUEST
      ).json({
        message: req.t('user:NOT_AN_ADMIN')
      });
    } else {

      // If user exists 
      // a) check if email provided from fb and in our db are same
      // b) if same --> login
      // c) if not same --> add this email in our db as secondary email
      // d) then login

      var userEmail = userData.userDataFromGoogle.email;
      var userId = userData.existingUserData[0].user_id;

      if (!userId) {
        return res.status(
          HTTP_STATUS_CODES.BAD_REQUEST
        ).json({
          message: req.t('user:USER_NOT_FOUND')
        });
      }

      var options = {
        select: ['email', 'user_id']
      };

      AuthDbo.getUserDataByEmail(userEmail, options, function (err, loggedInUserData) {

        if (err) {

          var responsePayload = {
            message: err.message
          };

          return res.status(
            err.httpStatusCode
          ).json(responsePayload);
        }

        // This email exists -> not a new email
        if (loggedInUserData.length) {

          UserDbo.getAdminUserRoleByUserId(userId, function (err, adminUserData) {
            if (err) {

              var responsePayload = {
                message: err.message
              };

              return res.status(
                err.httpStatusCode
              ).json(responsePayload);
            }

            if (!adminUserData) {

              var responsePayload = {
                message: req.t('user:NOT_AN_ADMIN')
              };

              return res.status(
                HTTP_STATUS_CODES.UNAUTHORIZED
              ).json(responsePayload);
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

                res.status(
                  HTTP_STATUS_CODES.BAD_REQUEST
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

                // publish kafka event
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
                  rsid: tokenData.redisRefreshTokenObj.rsid
                };

                return res.cookie('accessToken', tokenData.jwtToken, {
                  httpOnly: true,
                  maxAge: config.jwt.expiresInMilliseconds
                }).cookie('refreshToken', tokenData.encryptedRT, {
                  httpOnly: true,
                  maxAge: config.refreshToken.expiresInMilliseconds
                }).cookie('rsid', tokenData.redisRefreshTokenObj.rsid, {
                  httpOnly: true,
                  maxAge: config.refreshToken.expiresInMilliseconds
                }).cookie('sessIat', moment().unix(), {
                  httpOnly: true,
                  maxAge: config.jwt.expiresInMilliseconds
                }).status(
                  HTTP_STATUS_CODES.OK
                ).redirect(config.clientDomainUrl + "/");
              }
            });
          });
        } else {

          // This email does not exist -> new email
          async.waterfall([
            function registerSecondaryEmail(next) {

              var rawDataForSecondayEmail = {
                email: userEmail,
                user_id: userId
              }

              var secondaryEmailObj = getSecondaryEmailData(rawDataForSecondayEmail)

              UserDbo.registerSecondaryEmail(secondaryEmailObj, function (err, registeredUserProvider) {

                // DO NOT BOTHER IF THERE IS ANY ERROR FROM DB. WE ARE JUST TRYING TO INSERT NEW EMAIL
                // ONLY IF EMAIL DOES NOT EXIST. WHEN THIS EMAIL IS ALREADY EXISTS ON DB
                // DB THROWS DUP_ENTRY ERROR. WE DO NOT NEED TO HANDLE IT SPECIFICALLY

                return next(null);
              });
            }, function (next) {

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
                } else {

                  var userLoginDeviceData = getLoggedInDeviceData(req.headers['user-agent'], req.body);
                  userLoginDeviceData.userId = userId;
                  userLoginDeviceData.tokenData = tokenData;
                  userLoginDeviceData.clientIp = clientIp;

                  AuthCtrl.registerDeviceNSaveLoginHistory(userLoginDeviceData, function (err, loginDeviceSavedResp) {

                    // DO NOT BOTHER IF THERE IS ANY ERROR FROM DB. WE ARE TRYING TO INSERT DEVICE DATA AND 
                    // LOGIN HISTORY DATA HERE. RESPONSE IS NOT NEEDED
                  });

                  var tokenPayload = {
                    accessToken: tokenData.jwtToken,
                    refreshToken: tokenData.encryptedRT,
                    rsid: tokenData.redisRefreshTokenObj.rsid
                  };

                  // return next(null, tokenPayload);

                  return res.cookie('accessToken', tokenData.jwtToken, {
                    httpOnly: true,
                    maxAge: config.jwt.expiresInMilliseconds,
                  }).cookie('refreshToken', tokenData.encryptedRT, {
                    httpOnly: true,
                    maxAge: config.refreshToken.expiresInMilliseconds,
                  }).cookie('rsid', tokenData.redisRefreshTokenObj.rsid, {
                    httpOnly: true,
                    maxAge: config.refreshToken.expiresInMilliseconds,
                  }).cookie('sessIat', moment().unix(), {
                    httpOnly: true,
                    maxAge: config.jwt.expiresInMilliseconds,
                  }).status(
                    HTTP_STATUS_CODES.OK
                  ).redirect(config.clientDomainUrl + "/");
                }
              });
            }
          ], function (errObj, tokenPayload) {

            if (errObj) {

              return res.status(
                errObj.httpStatusCode
              ).json({
                message: errObj.message
              });
            }

            res.status(
              HTTP_STATUS_CODES.OK
            ).json(tokenPayload);
          });
        }
      });
    }
  })(req, res);;
}

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

      AuthDbo.getUserDataByEmail(
        userDataFromGoogle.email, { select: 'email, user_id' }, function (err, matchingAcocunts) {

          if (err) {

            return next(err);
          }

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
        var userDataForJWT = {
          user_id: userId
        };

        TokensCtrl.generateJWTnRefreshTokens(userDataForJWT, function (err, tokenData) {

          if (err) {

            const errMsg = req.t('SOMETHING_WENT_WRONG_PLEASE_TRY_AGAIN');
            var responsePayload = {
              message: errMsg
            };

            res.status(
              HTTP_STATUS_CODES.BAD_REQUEST
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

            // publish kafka event
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

            res.status(
              HTTP_STATUS_CODES.OK
            ).json(responsePayload);
          }
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

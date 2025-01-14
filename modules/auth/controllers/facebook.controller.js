'use strict';
var passport = require('passport');
var moment = require('moment');
var url = require('url');
var async = require('async');
var _ = require('lodash');
var Parser = require('ua-parser-js');
var DeviceDetector = require("device-detector-js");
const requestIp = require('request-ip');
var ShortUniqueId = require('short-unique-id');

var TokensCtrl = require('../controllers/tokens.controller');
var HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
var AuthCtrl = require('../controllers/auth.controller');
var config = require('../../../config/config');
var UserDbo = require('../dbo/user.dbo');
var AuthDbo = require('../dbo/auth.dbo');
const axios = require('axios');
const facebookUtils = require('./passport/strategies/facebook.strategy');
const { createId } =  require('@paralleldrive/cuid2');
var EmailCtrl = require('../../core/controllers/email.controller');
var emailConfig = require('../config/email.json');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const PROJECT_CONSTANTS = require('../constants/project.constants').CONSTANTS;


const appId = config.facebook.clientID;
const appSecret = config.facebook.clientSecret;

/**
  * @api {get} /oauth/facebook OAuth login with Facebook
  * @apiGroup Social Login
  *
  * @apiSuccess {String} accessToken Access token
  * @apiSuccess {String} refreshToken Refresh token
  * @apiSuccess {String} rsid session id for refresh token
  **/

exports.loginWithOAuthFacebook = function (req, res) {

  passport.authenticate('facebook', function(err, userData) {

    if(err) {

      const errMsg = req.t('SOMETHING_WENT_WRONG_PLEASE_TRY_AGAIN');
      var responsePayload = {
        message : req.t('facebook:AUTH_CODE_ALREADY_USED')
      };

      if(err.name && err.name == 'FacebookTokenError') {

        return res.status(
          HTTP_STATUS_CODES.BAD_REQUEST
        ).json(responsePayload);
      } else if (err.name && err.name == 'UserVerifyError') {

        var query = {
            error: err.name
        }

        return res.status(
          HTTP_STATUS_CODES.UNAUTHORIZED
        ).redirect(url.format({
          query: query
        }));
      } else {

        var responsePayload = {
          message : err.message
        };

        return res.status(
          err.httpStatusCode
        ).json(responsePayload);
      }
    }

    const clientIp = requestIp.getClientIp(req); 

    // If user doesn't exist --> register user --> then login
    if(!userData.existingUserData.length) {
      return res.status(
        HTTP_STATUS_CODES.BAD_REQUEST
      ).json({
        message : req.t('user:NOT_AN_ADMIN')
      });
    } else {

      // If user exists 
      // a) check if email provided from fb and in our db are same
      // b) if same --> login
      // c) if not same --> add this email in our db as secondary email
      // d) then login

      var userEmail = userData.userDataFromFb.email;
      var userId = userData.existingUserData[0].user_id;
      var options = {
        select : ['email', 'user_id']
      };

      AuthDbo.getUserDataByEmail(userEmail, options, function (err, loggedInUserData) {
      
        if(err) {

          var responsePayload = {
            message : err.message
          };

          return res.status(
            err.httpStatusCode
          ).json(responsePayload);
        }
        
        // This email exists -> not a new email
        if(loggedInUserData.length) {
          UserDbo.getAdminUserRoleByUserId(userId,  function (err, adminUserData) {
            if(err) {
  
              var responsePayload = {
                message : err.message
              };
    
              return res.status(
                err.httpStatusCode
              ).json(responsePayload);
            }
  
            if(!adminUserData) {
  
              var responsePayload = {
                message : req.t('user:NOT_AN_ADMIN')
              };
    
              return res.status(
                HTTP_STATUS_CODES.UNAUTHORIZED
              ).json(responsePayload);
            }
  
            var userDataForJWT = {
              user_id : userId
            };

            TokensCtrl.generateJWTnRefreshTokens(userDataForJWT, function (err, tokenData) {

              if(err) {
          
                const errMsg = req.t('SOMETHING_WENT_WRONG_PLEASE_TRY_AGAIN');
                var responsePayload = {
                  message : errMsg
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
                      provider: 'facebook'
                    }
                  }],
                  'logged_in'
                );
                
          
                var responsePayload = {
                  accessToken : tokenData.jwtToken,
                  refreshToken : tokenData.encryptedRT,
                  rsid : tokenData.redisRefreshTokenObj.rsid
                };

                res.status(
                  HTTP_STATUS_CODES.OK
                ).json(responsePayload);
                
                // res.cookie('accessToken', tokenData.jwtToken, {
                //   httpOnly : true,
                //   maxAge : config.jwt.expiresInMilliseconds,
                //   domain : config.cookieDomain
                // }).cookie('refreshToken', tokenData.encryptedRT, {
                //   httpOnly : true,
                //   maxAge : config.refreshToken.expiresInMilliseconds,
                //   domain : config.cookieDomain
                // }).cookie('rsid', tokenData.redisRefreshTokenObj.rsid, {
                //   httpOnly : true,
                //   maxAge : config.refreshToken.expiresInMilliseconds,
                //   domain : config.cookieDomain
                // }).cookie('sessIat', moment().unix(), {
                //   httpOnly : true,
                //   maxAge : config.jwt.expiresInMilliseconds,
                //   domain : config.cookieDomain
                // }).status(
                //   HTTP_STATUS_CODES.OK
                // ).redirect(config.creatorsWebDomainUrl);
              }
            });
          });
        } else {

          // This email does not exist -> new email
          async.waterfall([
            function registerSecondaryEmail(next) {
              
              var rawDataForSecondayEmail = {
                email : userEmail,
                user_id : userId
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
                user_id : userId
              };

              TokensCtrl.generateJWTnRefreshTokens(userDataForJWT, function (err, tokenData) {

                if(err) {
            
                  const errMsg = req.t('SOMETHING_WENT_WRONG_PLEASE_TRY_AGAIN');
                  var responsePayload = {
                    message : errMsg
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
                    accessToken : tokenData.jwtToken,
                    refreshToken : tokenData.encryptedRT,
                    rsid : tokenData.redisRefreshTokenObj.rsid
                  };

                  return next(null, tokenPayload);
                  
                  // res.cookie('accessToken', tokenData.jwtToken, {
                  //   httpOnly : true,
                  //   maxAge : config.jwt.expiresInMilliseconds,
                  //   domain : config.cookieDomain
                  // }).cookie('refreshToken', tokenData.encryptedRT, {
                  //   httpOnly : true,
                  //   maxAge : config.refreshToken.expiresInMilliseconds,
                  //   domain : config.cookieDomain
                  // }).cookie('rsid', tokenData.redisRefreshTokenObj.rsid, {
                  //   httpOnly : true,
                  //   maxAge : config.refreshToken.expiresInMilliseconds,
                  //   domain : config.cookieDomain
                  // }).cookie('sessIat', moment().unix(), {
                  //   httpOnly : true,
                  //   maxAge : config.jwt.expiresInMilliseconds,
                  //   domain : config.cookieDomain
                  // }).status(
                  //   HTTP_STATUS_CODES.OK
                  // ).redirect(config.creatorsWebDomainUrl);
                }
              });
            }
          ], function (errObj, tokenPayload) {
            
            if(errObj) {
            
              return res.status(
                errObj.httpStatusCode
              ).json({
                message : errObj.message
              });
            }

            res.status(
              HTTP_STATUS_CODES.OK
            ).json(tokenPayload);
          });
        }
      });
    }
  })(req, res);
};


/**
  * @api {post} /auth/signin/facebook Login with Facebook auth code / access token
  * @apiGroup Social Login
  *
  * @apiBody {String} access_token Facebook auth code / access token
  * 
  * @apiSuccess {String} accessToken Access token
  * @apiSuccess {String} refreshToken Refresh token
  * @apiSuccess {String} rsid session id for refresh token
  **/

exports.loginWithFacebookToken = async function (req, res) {

  try {
    let userData = {};
    const userAccessToken = req.body.access_token;

    // Get app access token
    const tokenUrl = `https://graph.facebook.com/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&grant_type=client_credentials`;
    const tokenResponse = await axios.get(tokenUrl);
    const appAccessToken = tokenResponse.data.access_token;

    // Verify the access token with Facebook
    const verificationUrl = `https://graph.facebook.com/debug_token?input_token=${userAccessToken}&access_token=${appAccessToken}`;
    const verificationResponse = await axios.get(verificationUrl);
    const verificationData = verificationResponse.data;

    if (!verificationData.data.is_valid) {
      return res.status(401).json({ message: 'Invalid access token' });
    }

    // Retrieve the user's information from Facebook
    const userInfoUrl = `https://graph.facebook.com/v17.0/me?fields=id,name,first_name,last_name,email,picture.width(700).height(700).redirect(0)&access_token=${userAccessToken}`;
    const userInfoResponse = await axios.get(userInfoUrl);
    const userInfo = userInfoResponse.data;

    const userDataFromFb = facebookUtils.restructureFacebookData(userInfo);
    
    if(!userDataFromFb.email) {
      return res.status(
        HTTP_STATUS_CODES.BAD_REQUEST
      ).json({
        message : req.t('user:FB_NOT_SHARED_EMAIL_LOGIN')
      });
    }

    userData.userDataFromFb = userDataFromFb;

    const clientIp = requestIp.getClientIp(req); 
    
    AuthDbo.getUserDataByEmail(
      userDataFromFb.email, {select: 'email, user_id'}, function (err, matchingAcocunts) {

      if(err) {
        return res.status(
          HTTP_STATUS_CODES.BAD_REQUEST
        ).json({
          message : req.t('SOMETHING_WENT_WRONG')
        });
      }

      if(matchingAcocunts.length > 1) {
        return res.status(
          HTTP_STATUS_CODES.CONFLICT
        ).json({
          message : req.t('user:MULTIPLE_ACCOUNTS_REGISTERED_WITH_SAME_EMAIL'),
          email: userDataFromFb.email
        });
      }

      userData.existingUserData = matchingAcocunts;

      if(!userData.existingUserData.length) {
        var userObjForRegistration = getRegistrationUserObjFromRawData(userData.userDataFromFb);
        var providerObjForRegistration = getRegistrationProviderObjFromRawData(userData.userDataFromFb);
    
        async.waterfall([
          function registerUser(next) {
    
            UserDbo.registerUser(userObjForRegistration, function (err, registeredUserObj) {

              if(err) {
    
                var responsePayload = {
                  message : err.message
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
                    provider: 'facebook'
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

              return next(null, registeredUserObj); 
            });
          },
          function registerUserProvider(registeredUserObj, next) {
    
            UserDbo.registerUserProvider(providerObjForRegistration, function (err, registeredUserProvider) {
    
              if(err) {
    
                var responsePayload = {
                  message : err.message
                };
    
                return res.status(
                  err.httpStatusCode
                ).json(responsePayload);
              }
    
              var finalRegisteredUserObj = {
                registeredUserObj: userObjForRegistration,
                registeredUserProvider: providerObjForRegistration
              }
    
              return next(null, finalRegisteredUserObj); 
            });
          }, function generateLoginTokens(finalRegisteredUserObj, next) {
    
            var userDataForJWT = {
              user_id : finalRegisteredUserObj.registeredUserObj.user_id
            };
            var userId = finalRegisteredUserObj.registeredUserObj.user_id;
    
            TokensCtrl.generateJWTnRefreshTokens(userDataForJWT, async function (err, tokenData) {
    
              if(err) {
    
                const errMsg = req.t('SOMETHING_WENT_WRONG_PLEASE_TRY_AGAIN');
                var responsePayload = {
                  message : errMsg
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

                if(finalRegisteredUserObj.registeredUserObj.username && finalRegisteredUserObj.registeredUserObj.email) {
                  const emailVariables = {
                    username: "@" + finalRegisteredUserObj.registeredUserObj.username,
                  };
    
                  await sendWelcomeEmail(finalRegisteredUserObj.registeredUserObj.email, emailVariables);
                }
    
                var tokenPayload = {
                  firstTimeUser: true,
                  accessToken : tokenData.jwtToken,
                  refreshToken : tokenData.encryptedRT,
                  rsid : tokenData.redisRefreshTokenObj.rsid,
                  username: finalRegisteredUserObj.registeredUserObj.username,
                  displayName: finalRegisteredUserObj.registeredUserObj.display_name
                };
    
                return next(null, tokenPayload);
              }
            });
          }
        ], function (errObj, finalTokenObject) {
    
          if(errObj) {
    
            return res.status(
              errObj.httpStatusCode
            ).json({
              message : errObj.message
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
    
        var userEmail = userData.userDataFromFb.email;
        var userId = userData.existingUserData[0].user_id;

        var options = {
          select : ['email', 'user_id']
        };
    
        var userDataForJWT = {
          user_id : userId
        };

        TokensCtrl.generateJWTnRefreshTokens(userDataForJWT, function (err, tokenData) {

          if(err) {

            const errMsg = req.t('SOMETHING_WENT_WRONG_PLEASE_TRY_AGAIN');
            var responsePayload = {
              message : errMsg
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
                  provider: 'facebook'
                }
              }],
              'logged_in'
            );

            var responsePayload = {
              accessToken : tokenData.jwtToken,
              refreshToken : tokenData.encryptedRT,
              rsid : tokenData.redisRefreshTokenObj.rsid,
              username: userData.existingUserData[0].username
            };

            res.status(
              HTTP_STATUS_CODES.OK
            ).json(responsePayload);
          }
        });
      }
    });
  }  catch (error) {
    console.error('Error logging in with FB:', error);

    return res.status(
        HTTP_STATUS_CODES.BAD_REQUEST
    ).json({ 
        message: req.t('SOMETHING_WENT_WRONG')
    });
}
};


function getRegistrationUserObjFromRawData(userDataFromProvider) {
  
  var userObj = _.cloneDeep(userDataFromProvider);
  delete userObj.user_id_from_provider;
  userObj.display_name = (userObj.first_name)? userObj.first_name : '';
  userObj.display_name = (userObj.last_name)? userObj.first_name + ' ' + userObj.last_name : userObj.display_name;
  userObj.is_email_verified = true;

  return userObj;
}


function getRegistrationProviderObjFromRawData(userDataFromProvider) {

  var providerDataObj = {
    auth_provider_id: createId(),
    provider_type: 'facebook',
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
  
  if(payload.deviceData) {

    var deviceData = payload.deviceData;

    userLoginDeviceData.device = {
      model : deviceData.model,
      brand : deviceData.brand
    }

    userLoginDeviceData.os = {
      os : deviceData.os,
      os_version : deviceData.os_version
    }

    userLoginDeviceData.client = {
      client_type : deviceData.client_type,
      client_version : deviceData.client_version,
      client_major : deviceData.client_major,
      client_ua : deviceData.client_ua,
      client_engine : deviceData.client_engine
    }
  } else {

    var ua = Parser(userAgenet);

    var loginClientDeviceData = {
      brand : ua.device.vendor,
      model : ua.device.model
    };

    var loginClientUserDeviceData = {
      os : ua.os.name,
      os_version : ua.os.version
    };

    var loginClientData = {
      client_type : 'browser',
      client_version : ua.browser.version,
      client_major : ua.browser.major,
      client_ua : ua.ua,
      client_engine : ua.engine
    };

    if(!loginClientDeviceData.brand || loginClientDeviceData.brand == '') {

      var DD = new DeviceDetector();
      var device = DD.parse(ua.ua);

      if(device && device.device && device.device.brand) loginClientDeviceData.brand = device.device.brand

      if(ua.os.name && ua.os.name.toLocaleLowerCase() == 'mac os') {
        
        loginClientDeviceData.model = "MacBook";
      }
    }

    if(!loginClientDeviceData.model || loginClientDeviceData.model == '') {

      var DD = new DeviceDetector();
      var device = DD.parse(ua.ua);

      if(device && device.device && device.device.model) loginClientDeviceData.model = device.device.model
    }

    userLoginDeviceData = {
      device : loginClientDeviceData,
      os : loginClientUserDeviceData,
      client : loginClientData
    }
  }
  
  return userLoginDeviceData;
}

const sendWelcomeEmail = async (email, emailVariables) => {
  const templateName = "welcome to suprstar";
  const emailSubject = emailConfig.WELCOME_EMAIL_SUBJECT;

  return await EmailCtrl.sendEmailWithTemplateName(email, emailSubject, emailVariables, templateName);
}

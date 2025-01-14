'use strict';
var moment = require('moment');
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
const { createId } =  require('@paralleldrive/cuid2');
const qs = require('qs'); // qs is used to handle query string serialization
const googlePhoneNumberValidator = require('../../user/validators/google.lib.phonenumber.validator');
const { TOPICS, EVENTS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const PROJECT_CONSTANTS = require('../constants/project.constants').CONSTANTS;


/**
  * @api {post} /auth/signin/truecaller Login with Truecaller auth code / access token
  * @apiGroup Social Login
  *
  *
  * @apiParam {String} code Truecaller authorization code (Authorisation code from TcOAuthData callback from step 9).
  * @apiParam {String} code_verifier Truecaller code verifier (From step 12).
  * 
  * @apiSuccess {String} accessToken Access token
  * @apiSuccess {String} refreshToken Refresh token
  * @apiSuccess {String} rsid session id for refresh token
  **/
exports.loginWithTruecallerToken = async function (req, res) {
  let userData = {};
  const payload = req.body;
  let userInfo = {};

  try {
    const queryParams = qs.stringify({
      grant_type: 'authorization_code',
      client_id: config.truecaller.appKey,
      code: payload.code,
      code_verifier: payload.code_verifier
    });

    const fetchUserTokenResponse =  await axios.post('https://oauth-account-noneu.truecaller.com/v1/token', queryParams, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const fetchUserProfileResponse = await axios.get('https://oauth-account-noneu.truecaller.com/v1/userinfo', {
      headers: {
          'Authorization': 'Bearer ' + fetchUserTokenResponse.data.access_token
      }
    });

    userInfo = fetchUserProfileResponse.data;
  } catch (error) {
    console.error('Error truecaller get data:', error.response.data);

    return res.status(
      HTTP_STATUS_CODES.BAD_REQUEST
    ).json({
      message : req.t('truecaller:INVALID_TC_ACCESS_TOKEN')
    });
  }

  const userDataFromTc = restructureTruecallerData(userInfo);
  const mobile = googlePhoneNumberValidator.normalizeSinglePhoneNumber(userDataFromTc.mobile);
  userDataFromTc.mobile = mobile;

  userData.userDataFromTc = userDataFromTc;

  const clientIp = requestIp.getClientIp(req); 

  AuthDbo.getUserDataByMobile(
    userDataFromTc.mobile, {select: 'email, username, user_id'}, function (err, matchingAcocunts) {

    if(err) {

      return next(err);
    }

    if(matchingAcocunts.length > 1) {
      return res.status(
        HTTP_STATUS_CODES.CONFLICT
      ).json({
        message : req.t('user:MULTIPLE_ACCOUNTS_REGISTERED_WITH_SAME_MOBILE'),
        mobile: userDataFromTc.mobile
      });
    }

    userData.existingUserData = matchingAcocunts;

    if(!userData.existingUserData.length) {
      var userObjForRegistration = getRegistrationUserObjFromRawData(userData.userDataFromTc);
      var providerObjForRegistration = getRegistrationProviderObjFromRawData(userData.userDataFromTc);

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
                  provider: 'truecaller'
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

          TokensCtrl.generateJWTnRefreshTokens(userDataForJWT, function (err, tokenData) {

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
  
      var userMobile = userData.userDataFromTc.mobile;
      var userId = userData.existingUserData[0].user_id;
      var options = {
        select : ['mobile', 'user_id']
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
                provider: 'truecaller'
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
};

function getRegistrationUserObjFromRawData(userDataFromProvider) {
  
  var userObj = _.cloneDeep(userDataFromProvider);
  delete userObj.user_id_from_provider;
  userObj.display_name = (userObj.first_name)? userObj.first_name : '';
  userObj.display_name = (userObj.last_name)? userObj.first_name + ' ' + userObj.last_name : userObj.display_name;
  userObj.is_mobile_verified = true;

  return userObj;
}

function restructureTruecallerData(profile) {
  let user = {
    user_id : createId(),
    status : 'active',
    created_at : moment().format(config.moment.dbFormat),
    updated_at : moment().format(config.moment.dbFormat)
  };

  // user id from provider database
  // if (profile.id) {

  //   user.user_id_from_provider = profile.id
  // }
  if (profile.sub) {

    user.user_id_from_provider = profile.sub
  }

  // if (profile.phoneNumbers && profile.phoneNumbers.length) {

  //   user.mobile = profile.phoneNumbers[0];
  // }

  // if (profile.name) {

  //   if (profile.name.first) {

  //     user.first_name = profile.name.first;
  //   } else if (profile.name.last) {

  //     user.last_name = profile.name.last;
  //   }

  //   if (profile.name.first && profile.name.last) {

  //     user.display_name = profile.name.fist + ' ' + profile.name.last;
  //   }
  // }

  // if (profile.onlineIdentities && profile.onlineIdentities.email) {

  //   user.email = profile.onlineIdentities.email;
  //   user.is_email_verified = true;
  // }

  // // user profile pic
  // if (profile.avatarUrl) {

  //   user.profile_pic = profile.avatarUrl;
  // }

  if (profile.phone_number) {

    user.mobile = profile.phone_number;
    // Check if the phone number has more than 10 digits and remove the first 2 digits if true
    if (user.mobile.length > 10) {
      user.mobile = user.mobile.substring(2);
    }
  }


  if (profile.given_name) {

    user.first_name = profile.given_name;
    user.display_name = profile.given_name;
  }

  if (profile.family_name) {

    user.last_name = profile.family_name;
    user.display_name = user.display_name + " " + profile.family_name;
  }
  

  if (profile.gender) {

    user.gender = profile.gender.toLowerCase();
  }

  return user;
}

function getRegistrationProviderObjFromRawData(userDataFromProvider) {

  var providerDataObj = {
    auth_provider_id: createId(),
    provider_type: 'truecaller',
    user_id_from_provider: userDataFromProvider.user_id_from_provider,
    user_id: userDataFromProvider.user_id
  }

  return providerDataObj;
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
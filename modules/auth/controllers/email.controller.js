'use strict';
var passport = require('passport');
var TokensCtrl = require('../controllers/tokens.controller');
var HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
var config = require('../../../config/config');
var cuid = require('cuid');
var bcrypt = require('bcrypt');
var UsersCtrl = require('../controllers/user.controller');
var validationCtrl = require('../../core/controllers/validation.controller');
var authenticateUser = require('../validators/auth.validator').authenticateUser;
var moment = require('moment');
const requestIp = require('request-ip');
var AuthCtrl = require('../controllers/auth.controller');
var DeviceDetectorCtrl = require('../../core/controllers/device-detector.controller');


exports.loginWithEmail = function (req, res, next) {

  var payload = req.body;

  var credValidation = validationCtrl.validate(authenticateUser, payload);

  if(credValidation.error) {

    var errMsg = req.t('validation:VALIDATION_FAILED');
    var responsePayload = {
      message : errMsg,
      data : credValidation.error
    };
    return res.status(
      HTTP_CODES.BAD_REQUEST
    ).json(responsePayload);
  }

  passport.authenticate('local', function(err, user) {
    if(err) {

      var status = HTTP_CODES.BAD_REQUEST;

      var errMsg = req.t('SOMETHING_WENT_WRONG') + ' ' +
        req.t('PLEASE_TRY_AGAIN');

      if(err.authError || err.somethingWrong) {
        errMsg = err.authError;
        status = HTTP_CODES.UNAUTHORIZED;

      } else if (err.somethingWrong) {
        errMsg = err.somethingWrong;
        status = HTTP_CODES.BAD_REQUEST;

      } else if (err.noRecords) {
        errMsg = err.noRecords;
        status = HTTP_CODES.BAD_REQUEST;

      } else if (err.badRequest) {
        errMsg = err.badRequest.message;
        status = HTTP_CODES.BAD_REQUEST;
      } else if (err.noStudio) {
        errMsg = err.noStudio;
        status = HTTP_CODES.BAD_REQUEST;
      } else if (err.socialLogins) {
        errMsg = err.socialLogins;
        status = HTTP_CODES.BAD_REQUEST;
      }

      var responsePayload = {
        message : errMsg
      };

      if (err.noStudio) {
        responsePayload.errorCode = 'NO_USER'
      }

      return res.status(
        status
      ).json(responsePayload);

    } else {
        
      const clientIp = requestIp.getClientIp(req); 

      var userDataForJWT = {
        user_id : (user[0])? user[0].user_id : undefined
      };

      var userId = userDataForJWT.user_id;

      TokensCtrl.generateJWTnRefreshTokens(userDataForJWT, function (err, tokenData) {

        if(err) {

          const errMsg = req.t('SOMETHING_WENT_WRONG') + ' ' +
            req.t('PLEASE_TRY_AGAIN');
          var responsePayload = {
            message : errMsg
          };

          return res.status(
            HTTP_CODES.BAD_REQUEST
          ).json(responsePayload);
        } else {

            DeviceDetectorCtrl.getLoggedInDeviceData(req.headers['user-agent'], req.body, function(userLoginDeviceData) {

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

              
                res.status(
                    HTTP_CODES.OK
                ).json(tokenPayload);
            });
        }
      });
    }
  })(req, res);;
}

function trimUserDataForJWT(user) {
  user = user[0]

  var userDataForJWT = {
    id : user.id,
    studioId : user.studio_id,
    languageId : user.language_id,
    name : user.name
  }

  return userDataForJWT;
}

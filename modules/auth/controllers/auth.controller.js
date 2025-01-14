'use strict';

var HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
var AuthDbo = require('../dbo/auth.dbo');
var config = require('../../../config/config');

var async = require('async');
var moment = require('moment');
const { createId } =  require('@paralleldrive/cuid2');


exports.registerDeviceNSaveLoginHistory = function (userLoginDeviceData, done) {
  
  async.waterfall([
    function registerDevice(next) {

      var device = userLoginDeviceData.device;
      device.login_device_id = createId();

      // INSERT DEVICE DATA
      AuthDbo.registerDevice(device, function (err, registerDeviceResp) {

        if(err && err.customErrCode == 'RESOURCES_EXISTS') {

          // IF DEVICE ALREADY EXISTS -> GET DEVICE DATA FOR PRIMARY KEY i.e DEVICE ID
          AuthDbo.getDataIfDeviceExists(device, function (err, existingDeviceData) {

            if(err) {

              return next(err);
            }

            return next(null, existingDeviceData);
          });
        } else if (err && err.customErrCode != 'RESOURCES_EXISTS') {

          return next(err);  
        } else {

          return next(null, device);
        }        
      });
    }, function updateLoggedInDevice(device, next) {

      var userDevice = userLoginDeviceData.os;
      userDevice.user_login_device_id = createId();
      userDevice.login_device_id = device.login_device_id;
      userDevice.first_login_at = moment().format(config.moment.dbFormat);
      userDevice.last_login_at = moment().format(config.moment.dbFormat);
      userDevice.user_id = userLoginDeviceData.userId;

      // INSERT USER LOGIN DEVICE DATA
      AuthDbo.saveUserLoggedInDevice(userDevice, function (err, saveUserDeviceResp) {

        if(err && err.customErrCode == 'RESOURCES_EXISTS') {

          // IF USER DEVICE ALREADY EXISTS -> GET USER DEVICE DATA FOR PRIMARY KEY 
          // i.e USER LOGIN DEVICE ID
          AuthDbo.getDataIfUserLoggedInDeviceExists(userDevice, function (err, getUserLoggedInDeviceResp) {
    
            if(err) {

              return next(err);
            }
    
            return next(null, true, getUserLoggedInDeviceResp);
          });
        } else {

          return next(null, false, userDevice);
        }
      });
    }, function updateLogggedInDeviceLastLogin(userDevicesExists, userDeviceDataFromDb, next) {

      // UDPATE last_login_at IF DEVICE ALREADY EXISTS
      if(userDevicesExists) {
        
        var updateUserDeviceData = {
          last_login_at : moment().format(config.moment.dbFormat),
          updated_at : moment().format(config.moment.dbFormat)
        };

        AuthDbo.updateLogggedInDeviceLastLogin(updateUserDeviceData, function (err, updateLastLoginResp) {
    
          if(err) {

            return next(err);
          }
  
          return next(null, userDeviceDataFromDb);
        });
      } else {

        return next(null, userDeviceDataFromDb);
      }
    }, function insertLoginHistory(userDeviceDataFromDb, next) {

      var loginHistory = userLoginDeviceData.client;
      loginHistory.user_login_history_id = createId();
      loginHistory.user_id = userLoginDeviceData.userId;
      loginHistory.user_login_device_id = userDeviceDataFromDb.user_login_device_id;
      loginHistory.login_at = moment().format(config.moment.dbFormat);
      loginHistory.rsid = userLoginDeviceData.tokenData.redisRefreshTokenObj.rsid;
      loginHistory.ip_address = userLoginDeviceData.clientIp;

      // convert json data to string
      loginHistory.client_engine = (JSON.stringify(userLoginDeviceData.client.client_engine));

      AuthDbo.insertLoginHistory(loginHistory, function (err, getUserLoggedInDeviceResp) {
    
        if(err) {

          return next(err);
        }

        return done(null);
        return next(null, true, getUserLoggedInDeviceResp);
      });
    }
  ], function (errObj, finalDeviceNLoggedInHisotryObj) {
        
    if(errObj) {
    
      return done(errObj);
    }

    return done(null, finalDeviceNLoggedInHisotryObj);
  });
}
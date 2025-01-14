var Parser = require('ua-parser-js');
var DeviceDetector = require("device-detector-js");

exports.getLoggedInDeviceData = function (userAgenet, payload, callback) {
  
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
      
      var DD = new DeviceDetector();
      var device = DD.parse(ua.ua);

      if(!loginClientDeviceData.brand || loginClientDeviceData.brand == '') {
  
        if(device && device.device && device.device.brand) {

            loginClientDeviceData.brand = device.device.brand
        }

  
        if(ua.os.name && ua.os.name.toLocaleLowerCase() == 'mac os') {
          
          loginClientDeviceData.model = "MacBook";
        }
      }
  
      if(!loginClientDeviceData.model || loginClientDeviceData.model == '') {
  
        if(device && device.device && device.device.model) {

            loginClientDeviceData.model = device.device.model
        }
      }
  
      userLoginDeviceData = {
        device : loginClientDeviceData,
        os : loginClientUserDeviceData,
        client : loginClientData
      }
    }
    
    return callback(userLoginDeviceData);
}
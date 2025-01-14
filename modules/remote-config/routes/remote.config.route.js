'use strict';
const versionConfig = require('../../version');
const RemoteConfigCtrl = require('../controllers/remote.config.controller');
var AuthMiddleware = require('../../auth/middlewares/auth.middleware');


module.exports = function (app) {

  app.route(
    versionConfig.routePrefix +
    "/remote-config/system"
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    RemoteConfigCtrl.getAllRemoteConfigKeysAndValues
  );

};

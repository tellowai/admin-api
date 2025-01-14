'use strict';
const versionConfig = require('../../version');
const ActivitylogCtrl = require('../controllers/activitylog.controller');
var AuthMiddleware = require('../../auth/middlewares/auth.middleware');


module.exports = function (app) {
  
  app.route(
    versionConfig.routePrefix +
    "/activitylog"
  ).get(
    AuthMiddleware.isAdminUser,
    ActivitylogCtrl.getAllLogs
  );
};

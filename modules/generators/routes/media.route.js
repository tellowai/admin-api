'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const MediaCtrl = require('../controllers/media.controller');

module.exports = function(app) {
  app.route(
    versionConfig.routePrefix + '/media'
  ).get(
    AuthMiddleware.isAdminUser,
    MediaCtrl.listAdminMedia
  );
}; 
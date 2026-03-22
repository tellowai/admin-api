'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const AppThemeCtrl = require('../controllers/app.theme.controller');

module.exports = function (app) {
  const prefix = versionConfig.routePrefix + '/admin/app-theme';

  app.route(prefix)
    .get(AuthMiddleware.isAdminUser, AppThemeCtrl.getAppTheme)
    .post(AuthMiddleware.isAdminUser, AppThemeCtrl.saveDraft);

  app.route(prefix + '/versions')
    .get(AuthMiddleware.isAdminUser, AppThemeCtrl.getVersions);

  app.route(prefix + '/:id/publish')
    .post(AuthMiddleware.isAdminUser, AppThemeCtrl.publish);

  app.route(prefix + '/rollback/:id')
    .post(AuthMiddleware.isAdminUser, AppThemeCtrl.rollback);
};

'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const ScriptFontCtrl = require('../controllers/script.font.controller');

module.exports = function (app) {
  const prefix = versionConfig.routePrefix + '/admin/sdui/script-fonts';

  app.route(prefix + '/registry')
    .get(AuthMiddleware.isAdminUser, ScriptFontCtrl.listRegistry);

  app.route(prefix + '/upload-config')
    .get(AuthMiddleware.isAdminUser, ScriptFontCtrl.getUploadConfig);

  app.route(prefix + '/manifest')
    .get(AuthMiddleware.isAdminUser, ScriptFontCtrl.getManifest);

  app.route(prefix + '/assets')
    .get(AuthMiddleware.isAdminUser, ScriptFontCtrl.listAssets)
    .post(AuthMiddleware.isAdminUser, ScriptFontCtrl.createAsset);

  app.route(prefix + '/assets/:id')
    .get(AuthMiddleware.isAdminUser, ScriptFontCtrl.getAsset)
    .put(AuthMiddleware.isAdminUser, ScriptFontCtrl.updateAsset)
    .delete(AuthMiddleware.isAdminUser, ScriptFontCtrl.deleteAsset);

  app.route(prefix + '/assets/:id/sources')
    .post(AuthMiddleware.isAdminUser, ScriptFontCtrl.addSource);

  app.route(prefix + '/assets/:assetId/sources/:sourceId')
    .delete(AuthMiddleware.isAdminUser, ScriptFontCtrl.deleteSource);

  app.route(prefix + '/defaults')
    .get(AuthMiddleware.isAdminUser, ScriptFontCtrl.listDefaults);

  app.route(prefix + '/defaults/:scriptKey')
    .put(AuthMiddleware.isAdminUser, ScriptFontCtrl.putDefault);

  app.route(prefix + '/template-overrides/:templateId')
    .get(AuthMiddleware.isAdminUser, ScriptFontCtrl.getTemplateOverrides)
    .put(AuthMiddleware.isAdminUser, ScriptFontCtrl.putTemplateOverrides);
};

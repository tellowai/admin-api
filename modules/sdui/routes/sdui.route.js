'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const SduiCtrl = require('../controllers/sdui.controller');

module.exports = function(app) {
  const prefix = versionConfig.routePrefix + '/admin/sdui';

  app.route(prefix + '/screens')
    .get(AuthMiddleware.isAdminUser, SduiCtrl.listScreens)
    .post(AuthMiddleware.isAdminUser, SduiCtrl.createScreen);

  app.route(prefix + '/screens/:id')
    .get(AuthMiddleware.isAdminUser, SduiCtrl.getScreen)
    .put(AuthMiddleware.isAdminUser, SduiCtrl.updateScreen)
    .delete(AuthMiddleware.isAdminUser, SduiCtrl.archiveScreen);

  app.route(prefix + '/screens/:id/publish')
    .post(AuthMiddleware.isAdminUser, SduiCtrl.publishScreen);

  app.route(prefix + '/screens/:id/versions')
    .get(AuthMiddleware.isAdminUser, SduiCtrl.listVersions);

  app.route(prefix + '/screens/:id/rollback/:versionId')
    .post(AuthMiddleware.isAdminUser, SduiCtrl.rollbackToVersion);

  app.route(prefix + '/screens/:id/duplicate')
    .post(AuthMiddleware.isAdminUser, SduiCtrl.duplicateScreen);

  app.route(prefix + '/registry')
    .get(AuthMiddleware.isAdminUser, SduiCtrl.listRegistry)
    .post(AuthMiddleware.isAdminUser, SduiCtrl.createRegistryEntry);

  app.route(prefix + '/registry/:id')
    .get(AuthMiddleware.isAdminUser, SduiCtrl.getRegistryEntry)
    .put(AuthMiddleware.isAdminUser, SduiCtrl.updateRegistryEntry)
    .delete(AuthMiddleware.isAdminUser, SduiCtrl.deprecateRegistryEntry);

  app.route(prefix + '/components')
    .get(AuthMiddleware.isAdminUser, SduiCtrl.listComponents)
    .post(AuthMiddleware.isAdminUser, SduiCtrl.createComponent);

  app.route(prefix + '/components/:id')
    .get(AuthMiddleware.isAdminUser, SduiCtrl.getComponent)
    .put(AuthMiddleware.isAdminUser, SduiCtrl.updateComponent)
    .delete(AuthMiddleware.isAdminUser, SduiCtrl.deleteComponent);

  app.route(prefix + '/components/:id/versions')
    .get(AuthMiddleware.isAdminUser, SduiCtrl.listComponentVersions);

  app.route(prefix + '/components/:id/rollback/:versionId')
    .post(AuthMiddleware.isAdminUser, SduiCtrl.rollbackComponentToVersion);

  app.route(prefix + '/blocks')
    .get(AuthMiddleware.isAdminUser, SduiCtrl.listBlocks)
    .post(AuthMiddleware.isAdminUser, SduiCtrl.createBlock);

  app.route(prefix + '/blocks/:id')
    .get(AuthMiddleware.isAdminUser, SduiCtrl.getBlock)
    .put(AuthMiddleware.isAdminUser, SduiCtrl.updateBlock)
    .delete(AuthMiddleware.isAdminUser, SduiCtrl.deleteBlock);

  app.route(prefix + '/blocks/:id/versions')
    .get(AuthMiddleware.isAdminUser, SduiCtrl.listBlockVersions);

  app.route(prefix + '/blocks/:id/rollback/:versionId')
    .post(AuthMiddleware.isAdminUser, SduiCtrl.rollbackBlockToVersion);
};

'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const SduiCtrl = require('../controllers/sdui.controller');
const SduiDataDictCtrl = require('../controllers/sdui.data-dictionary.controller');
const SduiBffResourcesCtrl = require('../controllers/sdui.bff-resources.controller');
const SduiPresentationRulesCtrl = require('../controllers/sdui.presentation-rules.controller');
const SduiFormattersCtrl = require('../controllers/sdui.formatters.controller');
const SduiDataBindingsCtrl = require('../controllers/sdui.data-bindings.controller');

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

  app.route(prefix + '/components/:id/publish')
    .post(AuthMiddleware.isAdminUser, SduiCtrl.publishComponent);

  app.route(prefix + '/components/by-key/:key')
    .get(AuthMiddleware.isAdminUser, SduiCtrl.getComponentByKey);

  app.route(prefix + '/blocks')
    .get(AuthMiddleware.isAdminUser, SduiCtrl.listBlocks)
    .post(AuthMiddleware.isAdminUser, SduiCtrl.createBlock);

  app.route(prefix + '/blocks/by-key/:blockKey').get(AuthMiddleware.isAdminUser, SduiCtrl.getBlockByKey);

  app.route(prefix + '/blocks/:id')
    .get(AuthMiddleware.isAdminUser, SduiCtrl.getBlock)
    .put(AuthMiddleware.isAdminUser, SduiCtrl.updateBlock)
    .delete(AuthMiddleware.isAdminUser, SduiCtrl.deleteBlock);

  app.route(prefix + '/blocks/:id/versions')
    .get(AuthMiddleware.isAdminUser, SduiCtrl.listBlockVersions);

  app.route(prefix + '/blocks/:id/rollback/:versionId')
    .post(AuthMiddleware.isAdminUser, SduiCtrl.rollbackBlockToVersion);

  app.route(prefix + '/blocks/:id/publish')
    .post(AuthMiddleware.isAdminUser, SduiCtrl.publishBlock);

  app.route(prefix + '/fonts')
    .get(AuthMiddleware.isAdminUser, SduiCtrl.listFonts)
    .post(AuthMiddleware.isAdminUser, SduiCtrl.createFont);

  app.route(prefix + '/fonts/:id')
    .put(AuthMiddleware.isAdminUser, SduiCtrl.updateFont)
    .delete(AuthMiddleware.isAdminUser, SduiCtrl.deleteFont);

  // --- Data Dictionary ---
  app.route(prefix + '/data-dictionary')
    .get(AuthMiddleware.isAdminUser, SduiDataDictCtrl.listDataDictionaryFields)
    .post(AuthMiddleware.isAdminUser, SduiDataDictCtrl.createDataDictionaryField);
  app.route(prefix + '/data-dictionary/:id')
    .put(AuthMiddleware.isAdminUser, SduiDataDictCtrl.updateDataDictionaryField)
    .delete(AuthMiddleware.isAdminUser, SduiDataDictCtrl.deleteDataDictionaryField);

  // --- BFF Resources ---
  app.route(prefix + '/bff-resources')
    .get(AuthMiddleware.isAdminUser, SduiBffResourcesCtrl.listBffResources)
    .post(AuthMiddleware.isAdminUser, SduiBffResourcesCtrl.createBffResource);
  app.route(prefix + '/bff-resources/:id')
    .put(AuthMiddleware.isAdminUser, SduiBffResourcesCtrl.updateBffResource)
    .delete(AuthMiddleware.isAdminUser, SduiBffResourcesCtrl.deleteBffResource);

  // --- Presentation Rules ---
  app.route(prefix + '/presentation-rules/:resourceKey')
    .get(AuthMiddleware.isAdminUser, SduiPresentationRulesCtrl.getPresentationRules);
  app.route(prefix + '/presentation-rules')
    .post(AuthMiddleware.isAdminUser, SduiPresentationRulesCtrl.createPresentationRule);
  app.route(prefix + '/presentation-rules/:id')
    .put(AuthMiddleware.isAdminUser, SduiPresentationRulesCtrl.updatePresentationRule)
    .delete(AuthMiddleware.isAdminUser, SduiPresentationRulesCtrl.deletePresentationRule);

  // --- Formatters ---
  app.route(prefix + '/formatters/:resourceKey')
    .get(AuthMiddleware.isAdminUser, SduiFormattersCtrl.getFormatters);
  app.route(prefix + '/formatters')
    .post(AuthMiddleware.isAdminUser, SduiFormattersCtrl.createFormatter);
  app.route(prefix + '/formatters/:id')
    .put(AuthMiddleware.isAdminUser, SduiFormattersCtrl.updateFormatter)
    .delete(AuthMiddleware.isAdminUser, SduiFormattersCtrl.deleteFormatter);

  // --- Data Bindings ---
  app.route(prefix + '/data-bindings/:entityType/:entityId')
    .get(AuthMiddleware.isAdminUser, SduiDataBindingsCtrl.getDataBindingsForEntity);
  app.route(prefix + '/data-bindings')
    .post(AuthMiddleware.isAdminUser, SduiDataBindingsCtrl.createDataBinding);
  app.route(prefix + '/data-bindings/:id')
    .put(AuthMiddleware.isAdminUser, SduiDataBindingsCtrl.updateDataBinding)
    .delete(AuthMiddleware.isAdminUser, SduiDataBindingsCtrl.deleteDataBinding);
};

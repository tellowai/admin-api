'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const AiRegistryCtrl = require('../controllers/ai-registry.controller');

module.exports = function (app) {
  const baseUrl = versionConfig.routePrefix + '/ai-registry';

  // --- AI Models ---

  // List AI models
  app.route(baseUrl + '/models')
    .get(AuthMiddleware.isAdminUser, AiRegistryCtrl.list)
    .post(AuthMiddleware.isAdminUser, AiRegistryCtrl.create);

  // List active models only (for fallback dropdown – backend enforces active only)
  app.route(baseUrl + '/models/for-fallback')
    .get(AuthMiddleware.isAdminUser, AiRegistryCtrl.listForFallback);

  // Single AI model
  app.route(baseUrl + '/models/:amrId')
    .get(AuthMiddleware.isAdminUser, AiRegistryCtrl.read)
    .patch(AuthMiddleware.isAdminUser, AiRegistryCtrl.update);

  // Mapping metadata for fallback mapping UI (inputs, parameters, outputs)
  app.route(baseUrl + '/models/:amrId/mapping-metadata')
    .get(AuthMiddleware.isAdminUser, AiRegistryCtrl.getMappingMetadata);

  // AI model status (active/inactive) – separate from general update
  app.route(baseUrl + '/models/:amrId/status')
    .patch(AuthMiddleware.isAdminUser, AiRegistryCtrl.updateStatus);

  // --- IO Definitions ---

  app.route(baseUrl + '/models/:amrId/io-definitions')
    .post(AuthMiddleware.isAdminUser, AiRegistryCtrl.createIoDefinition);

  app.route(baseUrl + '/io-definitions/:amiodId')
    .patch(AuthMiddleware.isAdminUser, AiRegistryCtrl.updateIoDefinition)
    .delete(AuthMiddleware.isAdminUser, AiRegistryCtrl.deleteIoDefinition);

  // --- Aux Data ---

  // List Providers
  app.route(baseUrl + '/providers')
    .get(AuthMiddleware.isAdminUser, AiRegistryCtrl.listProviders)
    .post(AuthMiddleware.isAdminUser, AiRegistryCtrl.createProvider);

  app.route(baseUrl + '/providers/:ampId')
    .patch(AuthMiddleware.isAdminUser, AiRegistryCtrl.updateProvider);

  // List Socket Types
  app.route(baseUrl + '/socket-types')
    .get(AuthMiddleware.isAdminUser, AiRegistryCtrl.listSocketTypes);

  // List Categories
  app.route(baseUrl + '/categories')
    .get(AuthMiddleware.isAdminUser, AiRegistryCtrl.listCategories);

};

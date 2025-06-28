'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const AiModelCtrl = require('../controllers/ai-model.controller');
const AiModelValidator = require('../validators/ai-model.validator');

module.exports = function(app) {
  // List all AI models
  app.route(
    versionConfig.routePrefix + '/ai-models'
  ).get(
    AuthMiddleware.isAdminUser,
    AiModelCtrl.listAiModels
  );

  // Create new AI model
  app.route(
    versionConfig.routePrefix + '/ai-models'
  ).post(
    AuthMiddleware.isAdminUser,
    AiModelValidator.validateCreateAiModel,
    AiModelCtrl.createAiModel
  );

  // Get AI model by ID
  app.route(
    versionConfig.routePrefix + '/ai-models/:modelId'
  ).get(
    AuthMiddleware.isAdminUser,
    AiModelCtrl.getAiModel
  );

  // Update AI model by ID
  app.route(
    versionConfig.routePrefix + '/ai-models/:modelId'
  ).patch(
    AuthMiddleware.isAdminUser,
    AiModelValidator.validateUpdateAiModel,
    AiModelCtrl.updateAiModel
  );

  // Platform routes
  // List all platforms
  app.route(
    versionConfig.routePrefix + '/ai-model-platforms'
  ).get(
    AuthMiddleware.isAdminUser,
    AiModelCtrl.listPlatforms
  );

  // Create new platform
  app.route(
    versionConfig.routePrefix + '/ai-model-platforms'
  ).post(
    AuthMiddleware.isAdminUser,
    AiModelValidator.validateCreatePlatform,
    AiModelCtrl.createPlatform
  );

  // Update platform by ID
  app.route(
    versionConfig.routePrefix + '/ai-model-platforms/:platformId'
  ).patch(
    AuthMiddleware.isAdminUser,
    AiModelValidator.validateUpdatePlatform,
    AiModelCtrl.updatePlatform
  );
}; 
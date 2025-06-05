'use strict';

const versionConfig = require('../../../modules/version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const aiModelsController = require('../controllers/ai-models.controller');

module.exports = function(app) {
  // Get all AI models
  app.route(
    versionConfig.routePrefix + '/ai-models'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    aiModelsController.getAllModels
  );
  
  // Get AI models by platform ID
  app.route(
    versionConfig.routePrefix + '/ai-models/platform/:platformId'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    aiModelsController.getModelsByPlatformId
  );
  
  // Get AI model by ID
  app.route(
    versionConfig.routePrefix + '/ai-models/:modelId'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    aiModelsController.getModelById
  );
  
  // Get AI model by slug
  app.route(
    versionConfig.routePrefix + '/ai-models/slug/:slug'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    aiModelsController.getModelBySlug
  );
  
  // Create a new AI model
  app.route(
    versionConfig.routePrefix + '/ai-models'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    aiModelsController.createModel
  );
  
  // Update an AI model
  app.route(
    versionConfig.routePrefix + '/ai-models/:modelId'
  ).put(
    AuthMiddleware.isAuthorizedJWT,
    aiModelsController.updateModel
  );
  
  // Archive an AI model
  app.route(
    versionConfig.routePrefix + '/ai-models/:modelId/archive'
  ).put(
    AuthMiddleware.isAuthorizedJWT,
    aiModelsController.archiveModel
  );
  
  // Unarchive an AI model
  app.route(
    versionConfig.routePrefix + '/ai-models/:modelId/unarchive'
  ).put(
    AuthMiddleware.isAuthorizedJWT,
    aiModelsController.unarchiveModel
  );
  
  // Delete an AI model (hard delete)
  app.route(
    versionConfig.routePrefix + '/ai-models/:modelId'
  ).delete(
    AuthMiddleware.isAuthorizedJWT,
    aiModelsController.deleteModel
  );
}; 
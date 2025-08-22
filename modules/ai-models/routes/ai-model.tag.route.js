'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const AiModelTagCtrl = require('../controllers/ai-model.tag.controller');
const AiModelTagValidator = require('../validators/ai-model.tag.validator');

module.exports = function(app) {
  // List all AI model tags
  app.route(
    versionConfig.routePrefix + '/ai-model-tags'
  ).get(
    AuthMiddleware.isAdminUser,
    AiModelTagCtrl.listAiModelTags
  );

  // Search AI model tags with pagination
  app.route(
    versionConfig.routePrefix + '/ai-model-tags/search'
  ).get(
    AuthMiddleware.isAdminUser,
    AiModelTagCtrl.searchAiModelTags
  );

  // Create new AI model tag
  app.route(
    versionConfig.routePrefix + '/ai-model-tags'
  ).post(
    AuthMiddleware.isAdminUser,
    AiModelTagValidator.validateCreateAiModelTag,
    AiModelTagCtrl.createAiModelTag
  );

  // Update AI model tag by ID
  app.route(
    versionConfig.routePrefix + '/ai-model-tags/:tagId'
  ).patch(
    AuthMiddleware.isAdminUser,
    AiModelTagValidator.validateUpdateAiModelTag,
    AiModelTagCtrl.updateAiModelTag
  );

  // Get AI model tag by ID
  app.route(
    versionConfig.routePrefix + '/ai-model-tags/:tagId'
  ).get(
    AuthMiddleware.isAdminUser,
    AiModelTagCtrl.getAiModelTag
  );
};

'use strict';

const versionConfig = require('../../../modules/version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const universalGeneratorController = require('../controllers/universal.generator.controller');

module.exports = function(app) {
  // Generate content using any AI model
  app.route(
    versionConfig.routePrefix + '/generators/universal/:model_id'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    universalGeneratorController.generateContent
  );
  
  // Get generation status
  // Required query parameters: platform, model_id (optional but recommended)
  app.route(
    versionConfig.routePrefix + '/generators/universal/status/:request_id'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    universalGeneratorController.getGenerationStatus
  );
  
  // Get generation result
  // Required query parameters: platform, model_id (optional but recommended)
  app.route(
    versionConfig.routePrefix + '/generators/universal/result/:request_id'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    universalGeneratorController.getGenerationResult
  );
  
  // This endpoint is now just a stub that returns an empty array
  app.route(
    versionConfig.routePrefix + '/generators/universal/requests'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    universalGeneratorController.getAllGenerationRequests
  );
}; 
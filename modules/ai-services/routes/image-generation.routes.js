'use strict';

const versionConfig = require('../../../modules/version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const imageGenerationController = require('../controllers/image-generation.controller');

module.exports = function(app) {
  // Route for generating an image with a prompt
  app.route(
    versionConfig.routePrefix + '/ai-services/image-generation'
  ).post(
    // AuthMiddleware.isAuthorizedJWT, // Uncomment this if authentication is required
    imageGenerationController.generateImage
  );
}; 
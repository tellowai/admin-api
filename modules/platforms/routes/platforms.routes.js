'use strict';

const versionConfig = require('../../../modules/version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const platformsController = require('../controllers/platforms.controller');

module.exports = function(app) {
  // Get all platforms
  app.route(
    versionConfig.routePrefix + '/platforms'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    platformsController.getAllPlatforms
  );
  
  // Get platform by ID
  app.route(
    versionConfig.routePrefix + '/platforms/:platformId'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    platformsController.getPlatformById
  );
  
  // Create a new platform
  app.route(
    versionConfig.routePrefix + '/platforms'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    platformsController.createPlatform
  );
  
  // Update a platform
  app.route(
    versionConfig.routePrefix + '/platforms/:platformId'
  ).put(
    AuthMiddleware.isAuthorizedJWT,
    platformsController.updatePlatform
  );
  
  // Delete a platform
  app.route(
    versionConfig.routePrefix + '/platforms/:platformId'
  ).delete(
    AuthMiddleware.isAuthorizedJWT,
    platformsController.deletePlatform
  );
}; 
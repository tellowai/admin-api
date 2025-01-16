'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const CollectionCtrl = require('../controllers/collection.controller');
const CollectionValidator = require('../validators/collection.validator');

module.exports = function(app) {
  app.route(
    versionConfig.routePrefix + '/collections'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    CollectionCtrl.listCollections
  );
  
  app.route(
    versionConfig.routePrefix + '/collections/search'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    CollectionCtrl.searchCollections
  );
  
  app.route(
    versionConfig.routePrefix + '/collections/templates'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    CollectionValidator.validateAddTemplatesToCollectionsData,
    CollectionCtrl.addTemplatesToCollections
  );
  
  app.route(
    versionConfig.routePrefix + '/collections'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    CollectionValidator.validateCreateCollectionData,
    CollectionCtrl.createCollection
  );

  app.route(
    versionConfig.routePrefix + '/collections/:collectionId'
  ).patch(
    AuthMiddleware.isAuthorizedJWT,
    CollectionValidator.validateUpdateCollectionData,
    CollectionCtrl.updateCollection
  );

  app.route(
    versionConfig.routePrefix + '/collections/:collectionId/archive'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    CollectionCtrl.archiveCollection
  );

  app.route(
    versionConfig.routePrefix + '/collections/:collectionId/templates'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    CollectionValidator.validateAddTemplatesData,
    CollectionCtrl.addTemplates
  );
}; 
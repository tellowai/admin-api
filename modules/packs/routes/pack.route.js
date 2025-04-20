'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const PackCtrl = require('../controllers/pack.controller');
const PackValidator = require('../validators/pack.validator');

module.exports = function(app) {
  app.route(
    versionConfig.routePrefix + '/packs'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    PackCtrl.listPacks
  );
  
  app.route(
    versionConfig.routePrefix + '/packs'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    PackValidator.validateCreatePackData,
    PackCtrl.createPack
  );

  app.route(
    versionConfig.routePrefix + '/packs/:packId'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    PackCtrl.getPack
  );

  app.route(
    versionConfig.routePrefix + '/packs/:packId'
  ).patch(
    AuthMiddleware.isAuthorizedJWT,
    PackValidator.validateUpdatePackData,
    PackCtrl.updatePack
  );

  app.route(
    versionConfig.routePrefix + '/packs/:packId/archive'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    PackCtrl.archivePack
  );

  app.route(
    versionConfig.routePrefix + '/packs/:packId/templates'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    PackCtrl.getPackTemplates
  );

  app.route(
    versionConfig.routePrefix + '/packs/:packId/templates'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    PackValidator.validateAddTemplatesData,
    PackCtrl.addTemplates
  );

  app.route(
    versionConfig.routePrefix + '/packs/:packId/templates'
  ).delete(
    AuthMiddleware.isAuthorizedJWT,
    PackValidator.validateRemoveTemplatesData,
    PackCtrl.removeTemplates
  );
}; 
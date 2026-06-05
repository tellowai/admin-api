'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const StudioToolCtrl = require('../controllers/studio-tool.controller');
const StudioToolValidator = require('../validators/studio-tool.validator');

module.exports = function (app) {
  app.route(versionConfig.routePrefix + '/studio-tools/page-config')
    .get(AuthMiddleware.isAuthorizedJWT, StudioToolCtrl.getPageConfig)
    .patch(
      AuthMiddleware.isAuthorizedJWT,
      StudioToolValidator.validateUpdatePageConfigData,
      StudioToolCtrl.updatePageConfig
    );

  app.route(versionConfig.routePrefix + '/studio-tools/sort-order')
    .patch(
      AuthMiddleware.isAuthorizedJWT,
      StudioToolValidator.validateUpdateSortOrderData,
      StudioToolCtrl.updateSortOrder
    );

  app.route(versionConfig.routePrefix + '/studio-tools')
    .get(AuthMiddleware.isAuthorizedJWT, StudioToolCtrl.listStudioTools)
    .post(
      AuthMiddleware.isAuthorizedJWT,
      StudioToolValidator.validateCreateStudioToolData,
      StudioToolCtrl.createStudioTool
    );

  app.route(versionConfig.routePrefix + '/studio-tools/:toolId')
    .patch(
      AuthMiddleware.isAuthorizedJWT,
      StudioToolValidator.validateUpdateStudioToolData,
      StudioToolCtrl.updateStudioTool
    );

  app.route(versionConfig.routePrefix + '/studio-tools/:toolId/archive')
    .post(AuthMiddleware.isAuthorizedJWT, StudioToolCtrl.archiveStudioTool);
};

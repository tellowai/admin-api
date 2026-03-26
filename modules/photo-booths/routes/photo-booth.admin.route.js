'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const Ctrl = require('../controllers/photo-booth.admin.controller');

module.exports = function (app) {
  const p = versionConfig.routePrefix + '/photo-booths';

  app.route(p).get(AuthMiddleware.isAuthorizedJWT, Ctrl.listBooths).post(AuthMiddleware.isAuthorizedJWT, Ctrl.createBooth);

  app
    .route(p + '/:boothId')
    .get(AuthMiddleware.isAuthorizedJWT, Ctrl.getBooth)
    .patch(AuthMiddleware.isAuthorizedJWT, Ctrl.patchBooth);

  app.route(p + '/:boothId/archive').post(AuthMiddleware.isAuthorizedJWT, Ctrl.archiveBooth);

  app.route(p + '/:boothId/templates').post(AuthMiddleware.isAuthorizedJWT, Ctrl.addTemplate);

  app.route(p + '/:boothId/templates/reorder').patch(AuthMiddleware.isAuthorizedJWT, Ctrl.reorderTemplates);

  app
    .route(p + '/:boothId/templates/:templateId')
    .patch(AuthMiddleware.isAuthorizedJWT, Ctrl.patchTemplateLink)
    .delete(AuthMiddleware.isAuthorizedJWT, Ctrl.removeTemplate);

  app
    .route(p + '/:boothId/templates/:templateId/default')
    .post(AuthMiddleware.isAuthorizedJWT, Ctrl.setDefaultTemplate);

  app.route(p + '/:boothId/generations').get(AuthMiddleware.isAuthorizedJWT, Ctrl.listGenerations);

  app.route(p + '/:boothId/stats').get(AuthMiddleware.isAuthorizedJWT, Ctrl.getStats);
};

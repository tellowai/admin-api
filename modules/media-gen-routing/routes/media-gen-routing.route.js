'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const MediaGenRoutingCtrl = require('../controllers/media-gen-routing.controller');

module.exports = function (app) {
  const base = versionConfig.routePrefix + '/media-gen-routing';

  app.route(base + '/capabilities')
    .get(AuthMiddleware.isAdminUser, MediaGenRoutingCtrl.listCapabilities);

  app.route(base + '/styles')
    .get(AuthMiddleware.isAdminUser, MediaGenRoutingCtrl.listStyles);

  app.route(base + '/models')
    .get(AuthMiddleware.isAdminUser, MediaGenRoutingCtrl.listModelsForRouting);

  app.route(base + '/rules')
    .get(AuthMiddleware.isAdminUser, MediaGenRoutingCtrl.listRoutingRules)
    .post(AuthMiddleware.isAdminUser, MediaGenRoutingCtrl.createRoutingRule);

  app.route(base + '/rules/:id')
    .patch(AuthMiddleware.isAdminUser, MediaGenRoutingCtrl.updateRoutingRule)
    .delete(AuthMiddleware.isAdminUser, MediaGenRoutingCtrl.deleteRoutingRule);
};

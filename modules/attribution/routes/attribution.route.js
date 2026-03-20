'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const AttributionCtrl = require('../controllers/attribution.controller');

module.exports = function (app) {
  app
    .route(versionConfig.routePrefix + '/attribution/tracking-links')
    .get(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.listTrackingLinks)
    .post(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.createTrackingLink);

  app
    .route(versionConfig.routePrefix + '/attribution/tracking-links/:id')
    .patch(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.updateTrackingLink);

  app
    .route(versionConfig.routePrefix + '/attribution/influencers')
    .get(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.listInfluencers)
    .post(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.createInfluencer);

  app
    .route(versionConfig.routePrefix + '/attribution/influencers/:id/stats')
    .get(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.getInfluencerStats);

  app
    .route(versionConfig.routePrefix + '/attribution/influencers/:id')
    .patch(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.updateInfluencer);

  app
    .route(versionConfig.routePrefix + '/attribution/overview')
    .get(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.getOverview);

  app
    .route(versionConfig.routePrefix + '/attribution/links/:id/stats')
    .get(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.getLinkStats);
};

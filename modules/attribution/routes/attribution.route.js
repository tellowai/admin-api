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
    .route(versionConfig.routePrefix + '/attribution/overview/channel-groups/detail')
    .get(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.getOverviewChannelGroupDetail);

  app
    .route(versionConfig.routePrefix + '/attribution/overview/channel-groups')
    .get(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.getOverviewChannelGroups);

  app
    .route(versionConfig.routePrefix + '/attribution/influencers/:id/channel-groups/detail')
    .get(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.getProfileChannelGroupDetail);

  app
    .route(versionConfig.routePrefix + '/attribution/influencers/:id/channel-groups')
    .get(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.getProfileChannelGroups);

  app
    .route(versionConfig.routePrefix + '/attribution/links/:id/channel-groups/detail')
    .get(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.getLinkChannelGroupDetail);

  app
    .route(versionConfig.routePrefix + '/attribution/links/:id/channel-groups')
    .get(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.getLinkChannelGroups);

  app
    .route(versionConfig.routePrefix + '/attribution/diag/classification')
    .get(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.getClassificationDiag);

  app
    .route(versionConfig.routePrefix + '/attribution/links/:id/stats')
    .get(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.getLinkStats);

  app
    .route(versionConfig.routePrefix + '/attribution/events/timeline')
    .get(AuthMiddleware.isAuthorizedJWT, AttributionCtrl.getEventsTimeline);
};

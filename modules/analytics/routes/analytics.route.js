'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const AnalyticsCtrl = require('../controllers/analytics.controller');
const AnalyticsValidator = require('../validators/analytics.validator');

module.exports = function(app) {
  // Character Analytics Routes
  app.route(
    versionConfig.routePrefix + '/analytics/characters/creations'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateCharacterAnalyticsQuery,
    AnalyticsCtrl.getCharacterCreations
  );

  app.route(
    versionConfig.routePrefix + '/analytics/characters/trainings'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateCharacterAnalyticsQuery,
    AnalyticsCtrl.getCharacterTrainings
  );

  app.route(
    versionConfig.routePrefix + '/analytics/characters/summary'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateCharacterAnalyticsQuery,
    AnalyticsCtrl.getCharacterAnalyticsSummary
  );

  // Template Analytics Routes
  app.route(
    versionConfig.routePrefix + '/analytics/templates/views'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateTemplateAnalyticsQuery,
    AnalyticsCtrl.getTemplateViews
  );

  app.route(
    versionConfig.routePrefix + '/analytics/templates/tries'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateTemplateAnalyticsQuery,
    AnalyticsCtrl.getTemplateTries
  );

  app.route(
    versionConfig.routePrefix + '/analytics/templates/downloads'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateTemplateAnalyticsQuery,
    AnalyticsCtrl.getTemplateDownloads
  );

  app.route(
    versionConfig.routePrefix + '/analytics/templates/summary'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateTemplateAnalyticsQuery,
    AnalyticsCtrl.getTemplateAnalyticsSummary
  );

  app.route(
    versionConfig.routePrefix + '/analytics/templates/downloads-summary'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateTemplateAnalyticsQuery,
    AnalyticsCtrl.getTemplateDownloadsSummary
  );
};

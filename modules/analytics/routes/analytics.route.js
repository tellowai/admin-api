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
    versionConfig.routePrefix + '/analytics/templates/successes'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateTemplateAnalyticsQuery,
    AnalyticsCtrl.getTemplateSuccesses
  );

  app.route(
    versionConfig.routePrefix + '/analytics/templates/failures'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateTemplateAnalyticsQuery,
    AnalyticsCtrl.getTemplateFailures
  );

  app.route(
    versionConfig.routePrefix + '/analytics/templates/top-by-generation'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateTemplateTopByGenerationQuery,
    AnalyticsCtrl.getTopTemplatesByGeneration
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

  // Auth Analytics Routes (Signup & Login)
  app.route(
    versionConfig.routePrefix + '/analytics/auth/signups'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateSignupAnalyticsQuery,
    AnalyticsCtrl.getSignups
  );

  app.route(
    versionConfig.routePrefix + '/analytics/auth/logins'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateLoginAnalyticsQuery,
    AnalyticsCtrl.getLogins
  );

  app.route(
    versionConfig.routePrefix + '/analytics/auth/summary'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateSignupAnalyticsQuery,
    AnalyticsCtrl.getAuthAnalyticsSummary
  );

  // Purchases Analytics Routes
  app.route(
    versionConfig.routePrefix + '/analytics/purchases'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validatePurchasesAnalyticsQuery,
    AnalyticsCtrl.getPurchases
  );

  app.route(
    versionConfig.routePrefix + '/analytics/purchases/summary'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validatePurchasesAnalyticsQuery,
    AnalyticsCtrl.getPurchasesSummary
  );

  // Credits analytics (issued, deducted, users from credits_daily_stats)
  app.route(
    versionConfig.routePrefix + '/analytics/credits'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateCreditsAnalyticsQuery,
    AnalyticsCtrl.getCredits
  );

  app.route(
    versionConfig.routePrefix + '/analytics/credits/summary'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateCreditsAnalyticsQuery,
    AnalyticsCtrl.getCreditsSummary
  );

  app.route(
    versionConfig.routePrefix + '/analytics/credits/stuck-counts'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    AnalyticsValidator.validateCreditsAnalyticsQuery,
    AnalyticsCtrl.getCreditsStuckCounts
  );

};

'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const TuningCtrl = require('../controllers/tuning.controller');
const TuningValidator = require('../validators/tuning.ai.model.validator');
const TuningRateLimiterMiddleware = require('../middlewares/tuning.ratelimiter.middleware');
const SubscriptionMiddleware = require('../middlewares/subscription.middleware');
const WebhookValidator = require('../validators/webhook.validator');
const WebhookCtrl = require('../controllers/webhook.controller');

module.exports = function(app) {
  app.route(
    versionConfig.routePrefix + '/photo-tuning-sessions'
  ).post(
    AuthMiddleware.isAdminUser,
    TuningRateLimiterMiddleware.isPhotoModelTuningRateLimited,
    TuningValidator.validateCreatePhotoTuningSession,
    TuningCtrl.createPhotoTuningSession
  );

  app.route(
    versionConfig.routePrefix + '/tuning-sessions/:tuningSessionId/fal/webhook'
  ).post(
    WebhookValidator.validateFalWebhook,
    WebhookCtrl.handleTuningWebhook
  );

  app.route(
    versionConfig.routePrefix + '/users/characters/:userCharacterId/tuning-sessions'
  ).get(
    AuthMiddleware.isAdminUser,
    TuningCtrl.getTuningSessionData
  );

  app.route(
    versionConfig.routePrefix + '/users/characters/:userCharacterId/tuning-sessions/:tuningSessionId/status'
  ).get(
    AuthMiddleware.isAdminUser,
    TuningCtrl.checkTuningStatus
  );
}; 
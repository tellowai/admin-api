'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const ImageGenerator = require('../controllers/image.generator.controller');
const GeneratorValidator = require('../validators/generator.validator');
const GeneratorRateLimiterMiddleware = require('../middlewares/generator.ratelimiter.middleware');
const WebhookValidator = require('../validators/webhook.validator');
const WebhookController = require('../controllers/webhook.controller');

module.exports = function(app) {

  app.route(
    versionConfig.routePrefix + '/image-generations/:generationId/status'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    ImageGenerator.getImageGenerationStatus
  );

  app.route(
    versionConfig.routePrefix + '/image-generations/couple-inpainting/queue'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    GeneratorRateLimiterMiddleware.isGenerationRateLimited,
    GeneratorValidator.validateCoupleInpainting,
    ImageGenerator.handleCoupleInpainting
  );

  app.route(
    versionConfig.routePrefix + '/image-generations/multi-character-inpainting/queue'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    GeneratorRateLimiterMiddleware.isGenerationRateLimited,
    GeneratorValidator.validateMulticharacterInpainting,
    ImageGenerator.handleMultiCharacterInpainting
  );

  app.route(
    versionConfig.routePrefix + '/image-generations/text-to-image/queue'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    GeneratorRateLimiterMiddleware.isGenerationRateLimited,
    GeneratorValidator.validateTextToImage,
    ImageGenerator.handleTextToImage
  );

  app.route(
    versionConfig.routePrefix + '/image-generations/:generationId/fal/webhook'
  ).post(
    WebhookValidator.validateFalImageGenWebhook,
    WebhookController.handleImageGenerationFalWebhook
  );
}; 
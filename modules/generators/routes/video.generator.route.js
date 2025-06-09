'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const VideoGenerator = require('../controllers/video.generator.controller');
const GeneratorValidator = require('../validators/generator.validator');
const GeneratorRateLimiterMiddleware = require('../middlewares/generator.ratelimiter.middleware');

module.exports = function(app) {

  app.route(
    versionConfig.routePrefix + '/video-generations/:generationId/status'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    VideoGenerator.getVideoGenerationStatus
  );

  app.route(
    versionConfig.routePrefix + '/video-generations/video-flow-composer/queue'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    GeneratorRateLimiterMiddleware.isVideoFlowComposerRateLimited,
    GeneratorValidator.validateVideoFlowComposer,
    VideoGenerator.handleVideoFlowComposer
  );

}; 
'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const VideoEditingController = require('../controllers/video.editing.controller');
const VideoEditingValidator = require('../validators/video.editing.validator');
const VideoEditingRateLimiter = require('../middlewares/video.editing.ratelimiter.middleware');

module.exports = function(app) {

  app.route(
    versionConfig.routePrefix + '/video-editing/merge/:generationId/status'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    VideoEditingController.getVideoMergeGenerationStatus
  );

  app.route(
    versionConfig.routePrefix + '/video-editing/merge'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    VideoEditingRateLimiter.isVideoMergeRateLimited,
    VideoEditingValidator.validateMergeVideos,
    VideoEditingController.mergeVideos
  );

}; 
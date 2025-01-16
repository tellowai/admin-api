'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const PresignedCtrl = require('../controllers/presigned.controller');
const PresignedValidator = require('../validators/presigned.validator');

module.exports = function(app) {
  app.route(
    versionConfig.routePrefix + '/os2/presigned-urls'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    PresignedValidator.validatePresignedUrlGeneration,
    PresignedCtrl.generatePresignedUrls
  );

  app.route(
    versionConfig.routePrefix + '/os2/presigned-urls/public'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    PresignedValidator.validatePresignedUrlGeneration,
    PresignedCtrl.generatePresignedPublicBucketUrls
  );
}; 
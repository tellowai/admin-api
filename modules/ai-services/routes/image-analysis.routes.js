'use strict';

const multer = require('multer');
const versionConfig = require('../../../modules/version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const imageAnalysisController = require('../controllers/image-analysis.controller');

// Configure multer storage for temporary file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  }
});

module.exports = function(app) {
  // Route for analyzing an image and extracting title and template prompt
  app.route(
    versionConfig.routePrefix + '/ai-services/image-analysis'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    upload.single('image'), 
    imageAnalysisController.analyzeImage
  );
}; 
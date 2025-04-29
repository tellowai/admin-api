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
    fileSize: 100 * 1024 * 1024, // 100MB limit, increased from 50MB
  }
});

// Custom error handler for multer errors
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        message: 'File too large. Maximum file size is 100MB.'
      });
    }
  }
  next(err);
};

module.exports = function(app) {
  // Route for analyzing an image and extracting title and template prompt
  app.route(
    versionConfig.routePrefix + '/ai-services/image-analysis'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    upload.single('image'),
    handleMulterError,
    imageAnalysisController.analyzeImage
  );

  // // New route for analyzing an image from URL (e.g., R2 bucket URL)
  // app.route(
  //   versionConfig.routePrefix + '/ai-services/image-analysis/url'
  // ).post(
  //   AuthMiddleware.isAuthorizedJWT,
  //   imageAnalysisController.analyzeImageFromUrl
  // );
}; 
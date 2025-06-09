'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const AiModelCtrl = require('../controllers/ai-model.controller');

module.exports = function(app) {
  app.route(
    versionConfig.routePrefix + '/ai-models'
  ).get(
    AuthMiddleware.isAdminUser,
    AiModelCtrl.listAiModels
  );
}; 
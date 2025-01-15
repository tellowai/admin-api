'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const TemplateCtrl = require('../controllers/template.controller');
const TemplateValidator = require('../validators/template.validator');

module.exports = function(app) {
  app.route(
    versionConfig.routePrefix + '/templates'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    TemplateCtrl.listTemplates
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateValidator.validateCreateTemplateData,
    TemplateCtrl.createTemplate
  );

  app.route(
    versionConfig.routePrefix + '/templates/:templateId'
  ).patch(
    AuthMiddleware.isAuthorizedJWT,
    TemplateValidator.validateUpdateTemplateData,
    TemplateCtrl.updateTemplate
  );

  app.route(
    versionConfig.routePrefix + '/templates/search'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    TemplateCtrl.searchTemplates
  );
}; 
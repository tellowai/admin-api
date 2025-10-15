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
  )
  
  app.route(
    versionConfig.routePrefix + '/templates/archived'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    TemplateCtrl.listArchivedTemplates
  );

  app.route(
    versionConfig.routePrefix + '/templates'
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

  app.route(
    versionConfig.routePrefix + '/templates/:templateId/archive'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateCtrl.archiveTemplate
  );

  app.route(
    versionConfig.routePrefix + '/templates/archive/bulk'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateValidator.validateBulkArchiveTemplatesData,
    TemplateCtrl.bulkArchiveTemplates
  );

  app.route(
    versionConfig.routePrefix + '/templates/unarchive/bulk'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateValidator.validateBulkUnarchiveTemplatesData,
    TemplateCtrl.bulkUnarchiveTemplates
  );

  app.route(
    versionConfig.routePrefix + '/templates/:templateId/copy'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateCtrl.copyTemplate
  );

  app.route(
    versionConfig.routePrefix + '/templates/export'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateValidator.validateExportTemplatesData,
    TemplateCtrl.exportTemplates
  );

  app.route(
    versionConfig.routePrefix + '/templates/import'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateValidator.validateImportTemplatesData,
    TemplateCtrl.importTemplates
  );
}; 
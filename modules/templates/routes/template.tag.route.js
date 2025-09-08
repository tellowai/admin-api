'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const TemplateTagCtrl = require('../controllers/template.tag.controller');
const TemplateTagValidator = require('../validators/template.tag.validator');

module.exports = function(app) {
  // List all template tag definitions with pagination
  app.route(
    versionConfig.routePrefix + '/template-tags'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    TemplateTagCtrl.listTemplateTagDefinitions
  );

  // Create new template tag definition
  app.route(
    versionConfig.routePrefix + '/template-tags'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateTagValidator.validateCreateTemplateTagData,
    TemplateTagCtrl.createTemplateTagDefinition
  );

  // Get template tag definition by ID
  app.route(
    versionConfig.routePrefix + '/template-tags/:tagId'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    TemplateTagCtrl.getTemplateTagDefinitionById
  );

  // Update template tag definition
  app.route(
    versionConfig.routePrefix + '/template-tags/:tagId'
  ).patch(
    AuthMiddleware.isAuthorizedJWT,
    TemplateTagValidator.validateUpdateTemplateTagData,
    TemplateTagCtrl.updateTemplateTagDefinition
  );

  // Archive template tag definition
  app.route(
    versionConfig.routePrefix + '/template-tags/:tagId/archive'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateTagCtrl.archiveTemplateTagDefinition
  );

  // Search template tag definitions
  app.route(
    versionConfig.routePrefix + '/template-tags/search'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    TemplateTagCtrl.searchTemplateTagDefinitions
  );

  // Bulk archive template tag definitions
  app.route(
    versionConfig.routePrefix + '/template-tags/archive/bulk'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateTagValidator.validateBulkArchiveTemplateTagsData,
    TemplateTagCtrl.bulkArchiveTemplateTagDefinitions
  );

  // Bulk unarchive template tag definitions
  app.route(
    versionConfig.routePrefix + '/template-tags/unarchive/bulk'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateTagValidator.validateBulkUnarchiveTemplateTagsData,
    TemplateTagCtrl.bulkUnarchiveTemplateTagDefinitions
  );
};

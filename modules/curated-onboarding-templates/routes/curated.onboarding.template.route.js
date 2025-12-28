'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const CuratedOnboardingTemplateCtrl = require('../controllers/curated.onboarding.template.controller');
const CuratedOnboardingTemplateValidator = require('../validators/curated.onboarding.template.validator');

module.exports = function(app) {
  // List all curated onboarding templates
  app.route(
    versionConfig.routePrefix + '/curated-onboarding-templates'
  ).get(
    AuthMiddleware.isAdminUser,
    CuratedOnboardingTemplateCtrl.listCuratedOnboardingTemplates
  );

  // Create new curated onboarding template
  app.route(
    versionConfig.routePrefix + '/curated-onboarding-templates'
  ).post(
    AuthMiddleware.isAdminUser,
    CuratedOnboardingTemplateValidator.validateCreateCuratedOnboardingTemplateData,
    CuratedOnboardingTemplateCtrl.createCuratedOnboardingTemplate
  );

  // Get curated onboarding template by ID
  app.route(
    versionConfig.routePrefix + '/curated-onboarding-templates/:cotId'
  ).get(
    AuthMiddleware.isAdminUser,
    CuratedOnboardingTemplateCtrl.getCuratedOnboardingTemplate
  );

  // Update curated onboarding template by ID
  app.route(
    versionConfig.routePrefix + '/curated-onboarding-templates/:cotId'
  ).patch(
    AuthMiddleware.isAdminUser,
    CuratedOnboardingTemplateValidator.validateUpdateCuratedOnboardingTemplateData,
    CuratedOnboardingTemplateCtrl.updateCuratedOnboardingTemplate
  );

  // Archive curated onboarding template by ID
  app.route(
    versionConfig.routePrefix + '/curated-onboarding-templates/:cotId/archive'
  ).post(
    AuthMiddleware.isAdminUser,
    CuratedOnboardingTemplateCtrl.archiveCuratedOnboardingTemplate
  );

  // Bulk create curated onboarding templates
  app.route(
    versionConfig.routePrefix + '/curated-onboarding-templates/bulk'
  ).post(
    AuthMiddleware.isAdminUser,
    CuratedOnboardingTemplateValidator.validateBulkCreateCuratedOnboardingTemplatesData,
    CuratedOnboardingTemplateCtrl.bulkCreateCuratedOnboardingTemplates
  );

  // Bulk archive curated onboarding templates by cot_ids
  app.route(
    versionConfig.routePrefix + '/curated-onboarding-templates/bulk/archive'
  ).post(
    AuthMiddleware.isAdminUser,
    CuratedOnboardingTemplateValidator.validateBulkArchiveCuratedOnboardingTemplatesData,
    CuratedOnboardingTemplateCtrl.bulkArchiveCuratedOnboardingTemplates
  );

  // Bulk archive curated onboarding templates by template_ids
  app.route(
    versionConfig.routePrefix + '/curated-onboarding-templates/bulk/archive-by-template-ids'
  ).post(
    AuthMiddleware.isAdminUser,
    CuratedOnboardingTemplateValidator.validateBulkArchiveByTemplateIdsData,
    CuratedOnboardingTemplateCtrl.bulkArchiveByTemplateIds
  );
};


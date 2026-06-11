'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const TemplateCtrl = require('../controllers/template.controller');
const TemplateMetadataInferenceCtrl = require('../controllers/template.metadata.inference.controller');
const TemplateVariantCtrl = require('../controllers/template.variant.controller');
const HeroPreviewCtrl = require('../controllers/hero.preview.controller');
const JourneyStageCtrl = require('../../journey-stages/controllers/journey.stage.controller');
const TemplateValidator = require('../validators/template.validator');

module.exports = function (app) {
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

  // Must be registered before `/templates/:templateId` or Express matches "search" as an id.
  app.route(
    versionConfig.routePrefix + '/templates/search'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    TemplateCtrl.searchTemplates
  );

  app.route(
    versionConfig.routePrefix + '/templates'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateValidator.validateCreateTemplateData,
    TemplateCtrl.createTemplate
  );

  app.route(
    versionConfig.routePrefix + '/templates/draft'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateValidator.validateCreateDraftTemplateData,
    TemplateCtrl.createDraftTemplate
  );

  app.route(
    versionConfig.routePrefix + '/templates/infer-metadata'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateValidator.validateInferTemplateMetadataData,
    TemplateMetadataInferenceCtrl.inferTemplateMetadata
  );

  app.route(
    versionConfig.routePrefix + '/templates/:templateId/variants'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    TemplateVariantCtrl.getTemplateVariants
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateVariantCtrl.linkVariants
  ).delete(
    AuthMiddleware.isAuthorizedJWT,
    TemplateVariantCtrl.unlinkVariant
  );

  app.route(
    versionConfig.routePrefix + '/templates/:templateId/journey-stages'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    JourneyStageCtrl.getTemplateJourneyStages
  ).put(
    AuthMiddleware.isAuthorizedJWT,
    JourneyStageCtrl.setTemplateJourneyStages
  );

  app.route(
    versionConfig.routePrefix + '/templates/:templateId/hover-card'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    TemplateCtrl.getTemplateHoverCard
  );

  app.route(
    versionConfig.routePrefix + '/templates/:templateId'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    TemplateCtrl.getTemplate
  );

  app.route(
    versionConfig.routePrefix + '/templates/:templateId/refresh-generation-meta'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateCtrl.refreshTemplateGenerationMeta
  );

  app.route(
    versionConfig.routePrefix + '/templates/:templateId/generate-hero-preview'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    HeroPreviewCtrl.generateHeroPreview
  );

  app.route(
    versionConfig.routePrefix + '/templates/:templateId/hero-preview-status'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    HeroPreviewCtrl.getHeroPreviewStatus
  );

  app.route(
    versionConfig.routePrefix + '/templates/:templateId/hero-frame-index'
  ).patch(
    AuthMiddleware.isAuthorizedJWT,
    HeroPreviewCtrl.updateHeroFrameIndex
  );

  app.route(
    versionConfig.routePrefix + '/templates/:templateId/ensure-ai-clips'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateValidator.validateEnsureAiClipsData,
    TemplateCtrl.ensureTemplateAiClips
  );

  app.route(
    versionConfig.routePrefix + '/templates/:templateId/reorder-clips'
  ).patch(
    AuthMiddleware.isAuthorizedJWT,
    TemplateValidator.validateReorderClipsData,
    TemplateCtrl.reorderTemplateClips
  );

  app.route(
    versionConfig.routePrefix + '/templates/:templateId/clips'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    TemplateValidator.validateAddClipData,
    TemplateCtrl.addTemplateClip
  );

  app.route(
    versionConfig.routePrefix + '/templates/:templateId/clips/:tacId'
  ).delete(
    AuthMiddleware.isAuthorizedJWT,
    TemplateCtrl.deleteTemplateClip
  );

  app.route(
    versionConfig.routePrefix + '/templates/:templateId'
  ).patch(
    AuthMiddleware.isAuthorizedJWT,
    TemplateValidator.validateUpdateTemplateData,
    TemplateCtrl.updateTemplate
  );

  app.route(
    versionConfig.routePrefix + '/templates/:templateId/status'
  ).patch(
    AuthMiddleware.isAuthorizedJWT,
    TemplateValidator.validateUpdateTemplateStatusData,
    TemplateCtrl.updateTemplateStatus
  );

  app.route(
    versionConfig.routePrefix + '/templates/status/bulk'
  ).patch(
    AuthMiddleware.isAuthorizedJWT,
    TemplateValidator.validateBulkUpdateTemplatesStatusData,
    TemplateCtrl.bulkUpdateTemplatesStatus
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
'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const NicheCtrl = require('../controllers/niche.controller');
const NicheFieldDefinitionCtrl = require('../controllers/niche.data.field.definition.controller');
const NicheFieldMatchingCtrl = require('../controllers/niche.field.matching.controller');
const NicheValidator = require('../validators/niche.validator');

module.exports = function(app) {
  // List all niches with pagination
  app.route(
    versionConfig.routePrefix + '/niches'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    NicheCtrl.listNiches
  );

  // Create new niche
  app.route(
    versionConfig.routePrefix + '/niches'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    NicheValidator.validateCreateNicheData,
    NicheCtrl.createNiche
  );

  // Get niche by ID
  app.route(
    versionConfig.routePrefix + '/niches/:nicheId'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    NicheCtrl.getNicheById
  );

  // Update niche
  app.route(
    versionConfig.routePrefix + '/niches/:nicheId'
  ).patch(
    AuthMiddleware.isAuthorizedJWT,
    NicheValidator.validateUpdateNicheData,
    NicheCtrl.updateNiche
  );

  // Archive niche
  app.route(
    versionConfig.routePrefix + '/niches/:nicheId/archive'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    NicheCtrl.archiveNiche
  );

  // List niche data field definitions with pagination
  app.route(
    versionConfig.routePrefix + '/niches/:nicheId/field-definitions'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    NicheFieldDefinitionCtrl.listNicheDataFieldDefinitions
  );

  // Bulk add field definitions to niche
  app.route(
    versionConfig.routePrefix + '/niches/:nicheId/field-definitions/bulk'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    NicheValidator.validateBulkCreateFieldDefinitionsData,
    NicheFieldDefinitionCtrl.bulkCreateNicheDataFieldDefinitions
  );

  // Bulk update field definitions
  app.route(
    versionConfig.routePrefix + '/niches/:nicheId/field-definitions/bulk'
  ).patch(
    AuthMiddleware.isAuthorizedJWT,
    NicheValidator.validateBulkUpdateFieldDefinitionsData,
    NicheFieldDefinitionCtrl.bulkUpdateNicheDataFieldDefinitions
  );

  // Archive single field definition
  app.route(
    versionConfig.routePrefix + '/niches/:nicheId/field-definitions/:ndfdId/archive'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    NicheFieldDefinitionCtrl.archiveNicheDataFieldDefinition
  );

  // Bulk archive field definitions
  app.route(
    versionConfig.routePrefix + '/niches/:nicheId/field-definitions/archive/bulk'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    NicheValidator.validateBulkArchiveFieldDefinitionsData,
    NicheFieldDefinitionCtrl.bulkArchiveNicheDataFieldDefinitions
  );

  // Match custom text input fields with niche field definitions
  app.route(
    versionConfig.routePrefix + '/niches/match-fields'
  ).post(
    AuthMiddleware.isAuthorizedJWT,
    NicheValidator.validateMatchCustomTextInputFieldsData,
    NicheFieldMatchingCtrl.matchCustomTextInputFields
  );
};


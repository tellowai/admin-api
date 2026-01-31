'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const WorkflowCtrl = require('../controllers/workflow.controller');
const WorkflowRegistryCtrl = require('../controllers/workflow.registry.controller');
const WorkflowValidator = require('../validators/workflow.validator');

module.exports = function (app) {

  // Workflow CRUD
  app.route(versionConfig.routePrefix + '/workflows')
    .get(
      AuthMiddleware.isAdminUser,
      WorkflowCtrl.listWorkflows
    )
    .post(
      AuthMiddleware.isAdminUser,
      WorkflowValidator.validateCreateWorkflow,
      WorkflowCtrl.createWorkflow
    );

  app.route(versionConfig.routePrefix + '/workflows/:workflowId')
    .get(
      AuthMiddleware.isAdminUser,
      WorkflowCtrl.getWorkflow
    )
    .put(
      AuthMiddleware.isAdminUser,
      WorkflowValidator.validateUpdateWorkflow,
      WorkflowCtrl.updateWorkflow
    )
    .delete(
      AuthMiddleware.isAdminUser,
      WorkflowCtrl.deleteWorkflow
    );

  // Auto-save endpoint (lightweight)
  app.route(versionConfig.routePrefix + '/workflows/:workflowId/auto-save')
    .put(
      AuthMiddleware.isAdminUser,
      WorkflowValidator.validateAutoSave,
      WorkflowCtrl.autoSaveWorkflow
    );

  // Manual save endpoint (with full validation)
  app.route(versionConfig.routePrefix + '/workflows/:workflowId/save')
    .put(
      AuthMiddleware.isAdminUser,
      WorkflowValidator.validateSaveWorkflow,
      WorkflowCtrl.saveWorkflow
    );

  // Publish workflow
  app.route(versionConfig.routePrefix + '/workflows/:workflowId/publish')
    .post(
      AuthMiddleware.isAdminUser,
      WorkflowCtrl.publishWorkflow
    );

  // Get validation rules for a model (for frontend)
  app.route(versionConfig.routePrefix + '/workflows/validation-rules/:modelId')
    .get(
      AuthMiddleware.isAdminUser,
      WorkflowCtrl.getModelValidationRules
    );

  // Workflow by clip (tac_id) – get/create/update by template_ai_clips.tac_id
  app.route(versionConfig.routePrefix + '/workflows/by-clip/:tacId')
    .get(
      AuthMiddleware.isAdminUser,
      WorkflowValidator.validateTacIdParam,
      WorkflowCtrl.getWorkflowByTacId
    );

  app.route(versionConfig.routePrefix + '/workflows/by-clip/:tacId/auto-save')
    .put(
      AuthMiddleware.isAdminUser,
      WorkflowValidator.validateTacIdParam,
      WorkflowValidator.validateAutoSave,
      WorkflowCtrl.autoSaveWorkflowByTacId
    );

  app.route(versionConfig.routePrefix + '/workflows/by-clip/:tacId/save')
    .put(
      AuthMiddleware.isAdminUser,
      WorkflowValidator.validateTacIdParam,
      WorkflowValidator.validateSaveWorkflow,
      WorkflowCtrl.saveWorkflowByTacId
    );

  // Registry routes
  app.route(versionConfig.routePrefix + '/workflow-builder/ai-models')
    .get(
      AuthMiddleware.isAdminUser,
      WorkflowRegistryCtrl.listActiveModels
    );

  app.route(versionConfig.routePrefix + '/workflow-builder/system-nodes')
    .get(
      AuthMiddleware.isAdminUser,
      WorkflowRegistryCtrl.listSystemNodes
    );
};

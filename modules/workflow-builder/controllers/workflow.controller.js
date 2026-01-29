'use strict';

const WorkflowModel = require('../models/workflow.model');
const WorkflowNodeModel = require('../models/workflow.node.model');
const WorkflowEdgeModel = require('../models/workflow.edge.model');
const WorkflowValidationService = require('../services/workflow.validation.service');
const WorkflowErrorHandler = require('../middlewares/workflow.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const KafkaCtrl = require('../../core/controllers/kafka.controller');
const { v4: uuidv4 } = require('uuid');

/**
 * List workflows with pagination
 */
exports.listWorkflows = async function (req, res) {
  try {
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const userId = req.user.userId;

    const searchParams = {
      status: req.query.status || null,
      search: req.query.search || null
    };

    const workflows = await WorkflowModel.listWorkflows(
      userId,
      searchParams,
      paginationParams
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: workflows
    });
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

/**
 * Get workflow with nodes and edges
 */
exports.getWorkflow = async function (req, res) {
  try {
    const { workflowId } = req.params;
    const userId = req.user.userId;

    const workflow = await WorkflowModel.getWorkflowById(workflowId, userId);

    if (!workflow) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('workflow:WORKFLOW_NOT_FOUND')
      });
    }

    // Get nodes and edges in parallel
    const [nodes, rawEdges] = await Promise.all([
      WorkflowNodeModel.getNodesByWorkflowId(workflowId),
      WorkflowEdgeModel.getEdgesByWorkflowId(workflowId)
    ]);

    // Stitch edges with node UUIDs (Zero-Join Policy)
    const nodeMap = new Map();
    nodes.forEach(node => {
      nodeMap.set(node.wfn_id, node.uuid);
    });

    const edges = rawEdges.map(edge => ({
      ...edge,
      source: nodeMap.get(edge.source_wfn_id),
      target: nodeMap.get(edge.target_wfn_id)
    }));

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        ...workflow,
        nodes,
        edges
      }
    });
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

/**
 * Create new workflow
 */
exports.createWorkflow = async function (req, res) {
  try {
    const { name, description } = req.validatedBody;
    const userId = req.user.userId;

    const workflowData = {
      uuid: uuidv4(),
      user_id: userId,
      name,
      description,
      status: 'draft'
    };

    const result = await WorkflowModel.createWorkflow(workflowData);

    // Publish activity log
    KafkaCtrl.sendMessage(
      KafkaCtrl.TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        admin_user_id: userId,
        entity_type: 'workflow',
        action_name: 'create',
        entity_id: result.insertId
      }],
      'workflow_created'
    );

    return res.status(HTTP_STATUS_CODES.CREATED).json({
      message: req.t('workflow:WORKFLOW_CREATED'),
      data: { wf_id: result.insertId, uuid: workflowData.uuid }
    });
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

/**
 * Update workflow metadata
 */
exports.updateWorkflow = async function (req, res) {
  // TODO: Implement update metadata (name, description etc)
  // For now, reusing saveWorkflow logic or similar
  return res.status(HTTP_STATUS_CODES.NOT_IMPLEMENTED).json({ message: "Not implemented yet" });
};

/**
 * Delete workflow
 */
exports.deleteWorkflow = async function (req, res) {
  // TODO: Implement delete (soft delete usually)
  return res.status(HTTP_STATUS_CODES.NOT_IMPLEMENTED).json({ message: "Not implemented yet" });
};

/**
 * Auto-save workflow (lightweight endpoint for frequent calls)
 */
exports.autoSaveWorkflow = async function (req, res) {
  try {
    const { workflowId } = req.params;
    const { nodes, edges, viewport, changeHash } = req.validatedBody;
    const userId = req.user.userId;

    // Verify ownership
    const workflow = await WorkflowModel.getWorkflowById(workflowId, userId);
    if (!workflow) {
      return res.status(HTTP_STATUS_CODES.FORBIDDEN).json({
        message: req.t('workflow:WORKFLOW_ACCESS_DENIED')
      });
    }

    // Check for conflicts (optimistic locking)
    if (changeHash && workflow.change_hash && workflow.change_hash !== changeHash) {
      return res.status(HTTP_STATUS_CODES.CONFLICT).json({
        error: 'CONFLICT',
        message: req.t('workflow:WORKFLOW_MODIFIED_ELSEWHERE'),
        serverHash: workflow.change_hash
      });
    }

    // Validate workflow data
    const validationResult = await WorkflowValidationService.validateWorkflow(nodes, edges);
    if (!validationResult.valid) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        error: 'VALIDATION_ERROR',
        message: req.t('workflow:VALIDATION_FAILED'),
        errors: validationResult.errors,
        nodeErrors: validationResult.nodeErrors
      });
    }

    // Save nodes and edges (transaction)
    const newHash = uuidv4().substring(0, 16);
    await WorkflowModel.saveWorkflowData(workflowId, {
      nodes,
      edges,
      viewport,
      change_hash: newHash
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      success: true,
      data: {
        savedAt: new Date().toISOString(),
        changeHash: newHash
      }
    });
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

/**
 * Manual save endpoint (full validation)
 */
exports.saveWorkflow = async function (req, res) {
  try {
    const { workflowId } = req.params;
    const { nodes, edges, viewport, metadata } = req.validatedBody;
    const userId = req.user.userId;

    // Similar to autosave but maybe stricter or updating metadata too
    const workflow = await WorkflowModel.getWorkflowById(workflowId, userId);
    if (!workflow) {
      return res.status(HTTP_STATUS_CODES.FORBIDDEN).json({
        message: req.t('workflow:WORKFLOW_ACCESS_DENIED')
      });
    }

    const validationResult = await WorkflowValidationService.validateWorkflow(nodes, edges);
    if (!validationResult.valid) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        error: 'VALIDATION_ERROR',
        message: req.t('workflow:VALIDATION_FAILED'),
        errors: validationResult.errors,
        nodeErrors: validationResult.nodeErrors
      });
    }

    const newHash = uuidv4().substring(0, 16);
    await WorkflowModel.saveWorkflowData(workflowId, {
      nodes,
      edges,
      viewport,
      change_hash: newHash
    });

    // Publish activity log
    KafkaCtrl.sendMessage(
      KafkaCtrl.TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        admin_user_id: userId,
        entity_type: 'workflow',
        action_name: 'save',
        entity_id: workflowId
      }],
      'workflow_saved'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      success: true,
      message: 'Workflow saved successfully',
      data: {
        savedAt: new Date().toISOString(),
        changeHash: newHash
      }
    });

  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

/**
 * Publish workflow
 */
exports.publishWorkflow = async function (req, res) {
  // TODO: Implement publish
  return res.status(HTTP_STATUS_CODES.NOT_IMPLEMENTED).json({ message: "Not implemented yet" });
};

/**
 * Get model validation rules
 */
exports.getModelValidationRules = async function (req, res) {
  try {
    const { modelId } = req.params;
    const rules = await WorkflowValidationService.getModelValidationRules(modelId);

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: rules
    });
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

'use strict';

const WorkflowModel = require('../models/workflow.model');
const WorkflowNodeModel = require('../models/workflow.node.model');
const WorkflowEdgeModel = require('../models/workflow.edge.model');
const AiModelRegistryModel = require('../models/ai-model-registry.model');
const TemplateModel = require('../../templates/models/template.model');
const WorkflowValidationService = require('../services/workflow.validation.service');
const WorkflowErrorHandler = require('../middlewares/workflow.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const KafkaCtrl = require('../../core/controllers/kafka.controller');
const { v4: uuidv4 } = require('uuid');
const StorageFactory = require('../../os2/providers/storage.factory');
const config = require('../../../config/config');
const logger = require('../../../config/lib/logger');

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
 * Enrich node config_values: for any value that is { bucket, asset_key }, add asset_url (presigned or public).
 */
async function enrichNodesWithAssetUrls(nodes) {
  if (!nodes || nodes.length === 0) return;
  const storage = StorageFactory.getProvider();
  const publicBucketUrl = config.os2?.r2?.public?.bucketUrl;
  const publicBucketName = config.os2?.r2?.public?.bucket;

  for (const node of nodes) {
    const configValues = node.config_values || {};
    for (const key of Object.keys(configValues)) {
      const val = configValues[key];
      if (!val || typeof val !== 'object' || !val.asset_key) continue;
      if (val.asset_url) continue; // already enriched
      const bucket = val.bucket || 'public';
      const keyPath = val.asset_key;
      try {
        const isPublic = bucket === 'public' || bucket === publicBucketName;
        if (isPublic && publicBucketUrl) {
          configValues[key].asset_url = `${publicBucketUrl}/${keyPath}`;
        } else {
          configValues[key].asset_url = await storage.generatePresignedDownloadUrl(keyPath, { expiresIn: 3600 });
        }
      } catch (err) {
        logger.warn('Workflow: failed to generate asset_url for node config', { nodeId: node.uuid, key, error: err.message });
      }
    }
  }
}

/**
 * Enrich nodes of type AI_MODEL with ai_model_registry row (by amr_id) as node.ai_model.
 */
async function enrichNodesWithAiModels(nodes) {
  if (!nodes || nodes.length === 0) return;
  const amrIds = nodes
    .filter(n => n.type === 'AI_MODEL' && n.amr_id != null)
    .map(n => n.amr_id);
  if (amrIds.length === 0) return;
  const rows = await AiModelRegistryModel.getByAmrIds(amrIds);
  const byAmrId = new Map(rows.map(r => [r.amr_id, r]));
  for (const node of nodes) {
    if (node.type === 'AI_MODEL' && node.amr_id != null) {
      node.ai_model = byAmrId.get(node.amr_id) || null;
    }
  }
}

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

    await enrichNodesWithAssetUrls(nodes);
    await enrichNodesWithAiModels(nodes);

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
 * Get workflow by clip (tac_id). Returns workflow data or 404 if no workflow linked.
 */
exports.getWorkflowByTacId = async function (req, res) {
  try {
    const { tacId } = req.params;
    const userId = req.user.userId;

    const wfId = await WorkflowModel.getWfIdByTacId(tacId);
    if (!wfId) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('workflow:WORKFLOW_NOT_FOUND')
      });
    }

    const [workflow, nodes, rawEdges] = await Promise.all([
      WorkflowModel.getWorkflowById(wfId, userId),
      WorkflowNodeModel.getNodesByWorkflowId(wfId),
      WorkflowEdgeModel.getEdgesByWorkflowId(wfId)
    ]);
    if (!workflow) {
      return res.status(HTTP_STATUS_CODES.FORBIDDEN).json({
        message: req.t('workflow:WORKFLOW_ACCESS_DENIED')
      });
    }
    await enrichNodesWithAssetUrls(nodes);
    await enrichNodesWithAiModels(nodes);
    const nodeMap = new Map(nodes.map(n => [n.wfn_id, n.uuid]));
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
 * Helper: Resolve node connections.
 * If a node parameter (handle) has an incoming edge, remove any manual value for that parameter
 * from the node's config_values/data.config_values to avoid conflicts.
 */
function cleanConnectedInputs(nodes, edges) {
  if (!nodes || !edges) return;
  const nodeMap = new Map();
  nodes.forEach(node => {
    // Index by all potential IDs
    if (node.id) nodeMap.set(String(node.id), node);
    if (node.uuid) nodeMap.set(String(node.uuid), node);
  });

  edges.forEach(edge => {
    const targetId = edge.target;
    const targetHandle = edge.targetHandle; // Corresponds to the input key (e.g., 'source_image')
    const targetNode = nodeMap.get(String(targetId));

    if (targetNode && targetHandle) {
      // Clear from root config_values
      if (targetNode.config_values && targetNode.config_values[targetHandle] !== undefined) {
        delete targetNode.config_values[targetHandle];
      }
      // Clear from data.config_values (ReactFlow/VueFlow shape)
      if (targetNode.data && targetNode.data.config_values && targetNode.data.config_values[targetHandle] !== undefined) {
        delete targetNode.data.config_values[targetHandle];
      }
      // Clear from data.inputs (Frontend sometimes uses this)
      if (targetNode.data && targetNode.data.inputs && targetNode.data.inputs[targetHandle] !== undefined) {
        delete targetNode.data.inputs[targetHandle];
      }
    }
  });
}

/**
 * Auto-save workflow by clip (tac_id). Creates template_ai_clips row and workflow when clip does not exist yet.
 */
exports.autoSaveWorkflowByTacId = async function (req, res) {
  try {
    const tacIdParam = req.params.tacId;
    const body = req.validatedBody;
    const { nodes, edges, viewport, changeHash } = body;
    const userId = req.user.userId;

    // Clean manual inputs that have connections
    cleanConnectedInputs(nodes, edges);

    let resolvedTacId = tacIdParam;
    const tacRow = await WorkflowModel.getTacRow(tacIdParam);
    if (!tacRow) {
      if (body.templateId != null && body.clipIndex !== undefined) {
        const { tac_id } = await TemplateModel.ensureTemplateAiClip(
          body.templateId,
          body.clipIndex,
          body.assetType || 'video'
        );
        resolvedTacId = tac_id;
      } else {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: req.t('workflow:WORKFLOW_NOT_FOUND')
        });
      }
    }

    const workflowId = await WorkflowModel.ensureWorkflowForTacId(resolvedTacId, userId);
    if (!workflowId) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('workflow:WORKFLOW_NOT_FOUND')
      });
    }
    const workflow = await WorkflowModel.getWorkflowById(workflowId, userId);
    if (!workflow) {
      return res.status(HTTP_STATUS_CODES.FORBIDDEN).json({
        message: req.t('workflow:WORKFLOW_ACCESS_DENIED')
      });
    }

    if (changeHash && workflow.change_hash && workflow.change_hash !== changeHash) {
      return res.status(HTTP_STATUS_CODES.CONFLICT).json({
        error: 'CONFLICT',
        message: req.t('workflow:WORKFLOW_MODIFIED_ELSEWHERE'),
        serverHash: workflow.change_hash
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

    const responseData = {
      workflowId,
      savedAt: new Date().toISOString(),
      changeHash: newHash
    };
    if (resolvedTacId !== tacIdParam) responseData.tacId = resolvedTacId;
    return res.status(HTTP_STATUS_CODES.OK).json({
      success: true,
      data: responseData
    });
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

/**
 * Manual save workflow by clip (tac_id). Creates template_ai_clips row and workflow when clip does not exist yet.
 */
exports.saveWorkflowByTacId = async function (req, res) {
  try {
    const tacIdParam = req.params.tacId;
    const body = req.validatedBody;
    const { nodes, edges, viewport, metadata } = body;
    const userId = req.user.userId;

    // Clean manual inputs that have connections
    cleanConnectedInputs(nodes, edges);

    let resolvedTacId = tacIdParam;
    const tacRow = await WorkflowModel.getTacRow(tacIdParam);
    if (!tacRow) {
      if (body.templateId != null && body.clipIndex !== undefined) {
        const { tac_id } = await TemplateModel.ensureTemplateAiClip(
          body.templateId,
          body.clipIndex,
          body.assetType || 'video'
        );
        resolvedTacId = tac_id;
      } else {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: req.t('workflow:WORKFLOW_NOT_FOUND')
        });
      }
    }

    const workflowId = await WorkflowModel.ensureWorkflowForTacId(resolvedTacId, userId);
    if (!workflowId) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('workflow:WORKFLOW_NOT_FOUND')
      });
    }
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

    const responseData = {
      workflowId,
      savedAt: new Date().toISOString(),
      changeHash: newHash
    };
    if (resolvedTacId !== tacIdParam) responseData.tacId = resolvedTacId;
    return res.status(HTTP_STATUS_CODES.OK).json({
      success: true,
      message: 'Workflow saved successfully',
      data: responseData
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

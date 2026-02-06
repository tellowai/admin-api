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
const { publishNewAdminActivityLog } = require('../../core/controllers/activitylog.controller');
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

function parseJsonField(value) {
  if (value == null) return value;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    return value;
  }
}

/**
 * Enrich nodes of type AI_MODEL with ai_model_registry row (by amr_id) as node.ai_model.
 * Batch-fetches parameter_schema and io definitions (inputs/outputs), appends to each ai_model.
 */
async function enrichNodesWithAiModels(nodes) {
  if (!nodes || nodes.length === 0) return;
  const amrIds = nodes
    .filter(n => n.type === 'AI_MODEL' && n.amr_id != null)
    .map(n => n.amr_id);
  if (amrIds.length === 0) return;

  const uniqueAmrIds = [...new Set(amrIds)];
  const [modelsRows, ioDefinitions, socketTypes] = await Promise.all([
    AiModelRegistryModel.getByAmrIdsWithParameterSchema(uniqueAmrIds),
    AiModelRegistryModel.getIODefinitionsByModelIds(uniqueAmrIds),
    AiModelRegistryModel.getAllSocketTypes()
  ]);

  const socketTypeMap = new Map(socketTypes.map(st => [st.amst_id, st]));
  const ioByModel = {};
  for (const io of ioDefinitions) {
    if (!ioByModel[io.amr_id]) {
      ioByModel[io.amr_id] = { inputs: [], outputs: [] };
    }
    const socketType = socketTypeMap.get(io.amst_id);
    const ioDef = {
      name: io.name,
      label: io.label || io.name,
      type: socketType?.name?.toLowerCase() || 'text',
      color: socketType?.color_hex || '#94a3b8',
      isRequired: io.is_required === 1,
      isList: io.is_list === 1,
      defaultValue: io.default_value
    };
    if (io.direction === 'INPUT') {
      ioByModel[io.amr_id].inputs.push(ioDef);
    } else {
      ioByModel[io.amr_id].outputs.push(ioDef);
    }
  }

  const ampIds = modelsRows.map(r => r.amp_id).filter(id => id != null);
  const uniqueAmpIds = [...new Set(ampIds)];
  let providerMap = new Map();
  if (uniqueAmpIds.length > 0) {
    const providers = await AiModelRegistryModel.getProvidersByIds(uniqueAmpIds);
    providerMap = new Map(providers.map(p => [p.amp_id, p]));
  }

  const byAmrId = new Map();
  for (const row of modelsRows) {
    byAmrId.set(row.amr_id, {
      amr_id: row.amr_id,
      name: row.name,
      label: row.name,
      platform_model_id: row.platform_model_id,
      provider: providerMap.get(row.amp_id)?.name || null,
      version: row.version,
      description: row.description,
      icon_url: row.icon_url,
      icon: row.icon ?? row.icon_url ?? null,
      color_hex: row.color_hex || '#8b5cf6',
      parameter_schema: parseJsonField(row.parameter_schema),
      pricing_config: parseJsonField(row.pricing_config),
      inputs: ioByModel[row.amr_id]?.inputs || [],
      outputs: ioByModel[row.amr_id]?.outputs || []
    });
  }

  for (const node of nodes) {
    if (node.type === 'AI_MODEL' && node.amr_id != null) {
      node.ai_model = byAmrId.get(node.amr_id) || null;
    }
  }
}

/**
 * Enrich nodes of type USER_INPUT, END, etc. with system_node definition (by amr_id = wsnd_id).
 * Attaches node.system_node with name, type_slug, inputs, outputs, config_schema, color_hex.
 */
async function enrichNodesWithSystemNodes(nodes) {
  if (!nodes || nodes.length === 0) return;

  const slugs = [...new Set(
    nodes
      .filter(n => n.type !== 'AI_MODEL' && n.system_node_type != null)
      .map(n => n.system_node_type)
  )];

  const wsndIdsLegacy = [...new Set(
    nodes
      .filter(n => n.type !== 'AI_MODEL' && n.system_node_type == null && n.amr_id != null)
      .map(n => n.amr_id)
  )];

  if (slugs.length === 0 && wsndIdsLegacy.length === 0) return;

  let defRows = [];

  if (slugs.length > 0) {
    const rows = await AiModelRegistryModel.getSystemNodeDefinitionsBySlugs(slugs);
    defRows = [...defRows, ...rows];
  }

  if (wsndIdsLegacy.length > 0) {
    const rows = await AiModelRegistryModel.getSystemNodeDefinitionsByIds(wsndIdsLegacy);
    defRows = [...defRows, ...rows];
  }

  // Deduplicate defRows by wsnd_id just in case
  defRows = [...new Map(defRows.map(item => [item.wsnd_id, item])).values()];

  if (defRows.length === 0) return;

  const allWsndIds = defRows.map(r => r.wsnd_id);

  const [ioDefinitions, socketTypes] = await Promise.all([
    AiModelRegistryModel.getSystemNodeIODefinitionsByNodeIds(allWsndIds),
    AiModelRegistryModel.getAllSocketTypes()
  ]);

  const socketTypeMap = new Map(socketTypes.map(st => [st.amst_id, st]));
  const ioByNode = {};
  for (const io of ioDefinitions) {
    if (!ioByNode[io.wsnd_id]) {
      ioByNode[io.wsnd_id] = { inputs: [], outputs: [] };
    }
    const socketType = socketTypeMap.get(io.amst_id);
    const ioDef = {
      name: io.name,
      label: io.label || io.name,
      type: socketType?.slug?.toLowerCase() || 'text',
      color: socketType?.color_hex || '#94a3b8',
      isRequired: io.is_required === 1,
      isList: io.is_list === 1,
      defaultValue: io.default_value ?? null
    };
    if (io.direction === 'INPUT') {
      ioByNode[io.wsnd_id].inputs.push(ioDef);
    } else {
      ioByNode[io.wsnd_id].outputs.push(ioDef);
    }
  }

  const byWsndId = new Map();
  const bySlug = new Map();
  for (const row of defRows) {
    const enriched = {
      wsnd_id: row.wsnd_id,
      name: row.name,
      label: row.name,
      type_slug: row.type_slug,
      icon: row.icon,
      color_hex: row.color_hex,
      config_schema: parseJsonField(row.config_schema),
      inputs: ioByNode[row.wsnd_id]?.inputs || [],
      outputs: ioByNode[row.wsnd_id]?.outputs || [],
      version: row.version
    };
    byWsndId.set(row.wsnd_id, enriched);
    if (row.type_slug) bySlug.set(row.type_slug, enriched);
  }

  for (const node of nodes) {
    if (node.type !== 'AI_MODEL') {
      if (node.system_node_type) {
        node.system_node = bySlug.get(node.system_node_type) || null;
        // RESTORE NODE TYPE from slug if 'STATIC_ASSET' to match frontend expectations
        if ((node.type === 'STATIC_ASSET' || node.type === 'SYSTEM') && node.system_node_type) {
          node.type = node.system_node_type;
        }
      } else if (node.amr_id) {
        node.system_node = byWsndId.get(node.amr_id) || null;
      }
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

    const workflow = await WorkflowModel.getWorkflowById(workflowId, null);

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
    await enrichNodesWithSystemNodes(nodes);

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
      WorkflowModel.getWorkflowById(wfId, null),
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
    await enrichNodesWithSystemNodes(nodes);
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
    let templateId = body.templateId; // From request if creating new clip

    const tacRow = await WorkflowModel.getTacRow(tacIdParam);
    if (tacRow) {
      templateId = tacRow.template_id;
    } else {
      if (body.templateId != null && body.clipIndex !== undefined) {
        const { tac_id } = await TemplateModel.ensureTemplateAiClip(
          body.templateId,
          body.clipIndex,
          body.assetType || 'video'
        );
        resolvedTacId = tac_id;
        // templateId is already body.templateId
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
    const workflow = await WorkflowModel.getWorkflowById(workflowId, null);
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

    await publishNewAdminActivityLog({
      adminUserId: userId,
      entityType: 'WORKFLOW',
      actionName: 'AUTO_SAVE_WORKFLOW_BY_TAC_ID',
      entityId: workflowId
    });

    // Update template image inputs summary using the resolved templateId
    if (templateId) {
      await TemplateModel.updateTemplateImageInputsFromClips(templateId);
    }

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
    const workflow = await WorkflowModel.getWorkflowById(workflowId, null);
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

    await publishNewAdminActivityLog({
      adminUserId: userId,
      entityType: 'WORKFLOW',
      actionName: 'SAVE_WORKFLOW_BY_TAC_ID',
      entityId: workflowId
    });

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

    await publishNewAdminActivityLog({
      adminUserId: userId,
      entityType: 'WORKFLOW',
      actionName: 'CREATE_WORKFLOW',
      entityId: result.insertId
    });

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
    const workflow = await WorkflowModel.getWorkflowById(workflowId, null);
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

    await publishNewAdminActivityLog({
      adminUserId: userId,
      entityType: 'WORKFLOW',
      actionName: 'AUTO_SAVE_WORKFLOW',
      entityId: workflowId
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
    const workflow = await WorkflowModel.getWorkflowById(workflowId, null);
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

    await publishNewAdminActivityLog({
      adminUserId: userId,
      entityType: 'WORKFLOW',
      actionName: 'SAVE_WORKFLOW',
      entityId: workflowId
    });

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

/**
 * Get cross-clip sources for the template: other clips and their nodes with outputs matching filterType.
 * Used by REF_CLIP_IMAGE / REF_CLIP_VIDEO / REF_CLIP_TEXT "source" picker. No joins; batch queries only.
 * Query: currentTacId (exclude), filterType (image|video|text).
 */
exports.getCrossClipSources = async function (req, res) {
  try {
    const { templateId } = req.params;
    const currentTacId = req.query.currentTacId || null;
    const filterType = (req.query.filterType || 'image').toLowerCase();

    const clipSummaries = await TemplateModel.getTemplateClipSummaries(templateId);
    // Include all other clips (even without wf_id) so UI can show "Clip 2", "Clip 3" etc.; nodes only for those with wf_id
    const clips = clipSummaries
      .filter(c => c.tac_id !== currentTacId)
      .map(c => ({ tac_id: c.tac_id, clip_index: c.clip_index, wf_id: c.wf_id || null, label: `Clip ${(c.clip_index || 0)}` }));

    const wfIds = clips.map(c => c.wf_id).filter(id => id != null);
    const nodes = wfIds.length > 0 ? await WorkflowNodeModel.getNodesByWorkflowIds(wfIds) : [];
    const wfIdToTacId = new Map(clips.filter(c => c.wf_id != null).map(c => [c.wf_id, c.tac_id]));

    const socketTypes = await AiModelRegistryModel.getAllSocketTypes();
    const amstIdToSlug = new Map((socketTypes || []).map(st => [st.amst_id, (st.slug || '').toLowerCase()]));

    const amrIds = [...new Set(nodes.filter(n => n.type === 'AI_MODEL' && n.amr_id != null).map(n => n.amr_id))];
    let amrIdToOutputs = new Map();
    let amrIdToAiModel = new Map();
    if (amrIds.length > 0) {
      const [ioDefs, aiModelRows] = await Promise.all([
        AiModelRegistryModel.getIODefinitionsByModelIds(amrIds),
        AiModelRegistryModel.getByAmrIds(amrIds)
      ]);
      aiModelRows.forEach(r => { amrIdToAiModel.set(r.amr_id, r); });
      const outputDefs = (ioDefs || []).filter(io => io.direction === 'OUTPUT');
      outputDefs.forEach(io => {
        if (!amrIdToOutputs.has(io.amr_id)) amrIdToOutputs.set(io.amr_id, []);
        amrIdToOutputs.get(io.amr_id).push({
          name: io.name,
          label: io.label || io.name,
          type: amstIdToSlug.get(io.amst_id) || 'text'
        });
      });
    }

    const systemDefs = await AiModelRegistryModel.listSystemNodeDefinitions(null, 100, 0);
    const wsndIds = (systemDefs || []).map(d => d.wsnd_id);
    let typeSlugToOutputs = new Map();
    let wsndIdToOutputs = new Map();
    if (wsndIds.length > 0) {
      const sysIo = await AiModelRegistryModel.getSystemNodeIODefinitionsByNodeIds(wsndIds);
      const sysOutputs = (sysIo || []).filter(io => io.direction === 'OUTPUT');
      const wsndIdToSlug = new Map((systemDefs || []).map(d => [d.wsnd_id, (d.type_slug || '').toLowerCase()]));
      sysOutputs.forEach(io => {
        const out = {
          name: io.name,
          label: io.label || io.name,
          type: amstIdToSlug.get(io.amst_id) || 'text'
        };
        if (!wsndIdToOutputs.has(io.wsnd_id)) wsndIdToOutputs.set(io.wsnd_id, []);
        wsndIdToOutputs.get(io.wsnd_id).push(out);
        const slug = wsndIdToSlug.get(io.wsnd_id);
        if (slug) {
          if (!typeSlugToOutputs.has(slug)) typeSlugToOutputs.set(slug, []);
          typeSlugToOutputs.get(slug).push(out);
        }
      });
    }

    const REF_CLIP_TYPES = ['REF_CLIP_IMAGE', 'REF_CLIP_VIDEO', 'REF_CLIP_TEXT'];
    const nodesWithOutputs = nodes
      .filter(node => !REF_CLIP_TYPES.includes(node.type || ''))
      .map(node => {
        let outputs = [];
        if (node.type === 'AI_MODEL' && node.amr_id != null) {
          outputs = amrIdToOutputs.get(node.amr_id) || [];
        } else {
          // System nodes: amr_id is wsnd_id in workflow_nodes (old) or system_node_type is set (new)
          outputs = (node.amr_id != null && wsndIdToOutputs.get(node.amr_id));
          if (!outputs) {
            outputs = typeSlugToOutputs.get((node.system_node_type || '').toLowerCase()) ||
              typeSlugToOutputs.get((node.type || '').toLowerCase()) ||
              [];
          }
        }
        return { ...node, outputs };
      })
      .filter(node => node.outputs.some(o => (o.type || '').toLowerCase() === filterType));

    const nodesByTacId = {};
    clips.forEach(c => { nodesByTacId[c.tac_id] = []; });
    nodesWithOutputs.forEach(node => {
      const tacId = wfIdToTacId.get(node.wf_id);
      if (!tacId || !nodesByTacId[tacId]) return;
      const nodeLabel = node.data?.label || node.config_values?.label || node.ui_metadata?.label || node.type || node.uuid;
      const matchingOutputs = node.outputs.filter(o => (o.type || '').toLowerCase() === filterType);
      const promptRaw = node.config_values?.prompt ?? node.config_values?.positive_prompt ?? '';
      const prompt_preview = typeof promptRaw === 'string' ? promptRaw.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
      const ai_model = node.type === 'AI_MODEL' && node.amr_id != null ? (amrIdToAiModel.get(node.amr_id) || null) : null;
      nodesByTacId[tacId].push({
        id: node.uuid,
        label: nodeLabel,
        outputs: matchingOutputs,
        prompt_preview: prompt_preview || null,
        ai_model: ai_model ? { amr_id: ai_model.amr_id, name: ai_model.name } : null
      });
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: { clips, nodesByTacId }
    });
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

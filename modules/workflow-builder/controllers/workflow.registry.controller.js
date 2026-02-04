'use strict';

const AiModelRegistryModel = require('../models/ai-model-registry.model');
const WorkflowErrorHandler = require('../middlewares/workflow.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const { publishNewAdminActivityLog } = require('../../core/controllers/activitylog.controller');

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
 * List active AI models for the node library (page-based: page=1,2,3 & page_size)
 */
exports.listActiveModels = async function (req, res) {
  try {
    const rawQ = req.query.q;
    const q = rawQ != null && String(rawQ).trim() !== '' ? String(rawQ).trim() : null;
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const modelsRaw = await AiModelRegistryModel.listActiveModels(
      q,
      paginationParams.limit,
      paginationParams.offset
    );

    if (modelsRaw.length === 0) {
      return res.status(HTTP_STATUS_CODES.OK).json({ data: [] });
    }

    const models = modelsRaw.map(m => ({
      ...m,
      parameter_schema: parseJsonField(m.parameter_schema),
      pricing_config: parseJsonField(m.pricing_config)
    }));

    const modelIds = models.map(m => m.amr_id);
    const providerIds = [...new Set(models.map(m => m.amp_id).filter(Boolean))];

    const [ioDefinitions, providers, socketTypes] = await Promise.all([
      AiModelRegistryModel.getIODefinitionsByModelIds(modelIds),
      AiModelRegistryModel.getProvidersByIds(providerIds),
      AiModelRegistryModel.getAllSocketTypes()
    ]);

    const providerMap = new Map(providers.map(p => [p.amp_id, p]));
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

    const enrichedModels = models.map(model => ({
      amr_id: model.amr_id,
      name: model.name,
      description: model.description,
      icon_url: model.icon_url,
      provider_name: providerMap.get(model.amp_id)?.name || null,
      inputs: ioByModel[model.amr_id]?.inputs || [],
      outputs: ioByModel[model.amr_id]?.outputs || [],
      parameter_schema: model.parameter_schema,
      pricing_config: model.pricing_config
    }));

    return res.status(HTTP_STATUS_CODES.OK).json({ data: enrichedModels });
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

/**
 * Get socket types
 */
exports.listSocketTypes = async function (req, res) {
  return res.status(HTTP_STATUS_CODES.OK).json({
    data: []
  });
};

/**
 * Get system nodes (for workflow builder - active only)
 */
exports.listSystemNodes = async function (req, res) {
  try {
    const rawQ = req.query.q;
    const q = rawQ != null && String(rawQ).trim() !== '' ? String(rawQ).trim() : null;
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const nodesRaw = await AiModelRegistryModel.listSystemNodeDefinitions(
      q,
      paginationParams.limit,
      paginationParams.offset
    );

    if (nodesRaw.length === 0) {
      return res.status(HTTP_STATUS_CODES.OK).json({ data: [] });
    }

    const nodes = nodesRaw.map(n => ({
      ...n,
      config_schema: parseJsonField(n.config_schema)
    }));

    const nodeIds = nodes.map(n => n.wsnd_id);

    const [ioDefinitions, socketTypes] = await Promise.all([
      AiModelRegistryModel.getSystemNodeIODefinitionsByNodeIds(nodeIds),
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
        isList: io.is_list === 1
      };

      if (io.direction === 'INPUT') {
        ioByNode[io.wsnd_id].inputs.push(ioDef);
      } else {
        ioByNode[io.wsnd_id].outputs.push(ioDef);
      }
    }

    const enrichedNodes = nodes.map(node => ({
      wsnd_id: node.wsnd_id,
      type_slug: node.type_slug,
      name: node.name,
      description: node.description,
      icon: node.icon,
      color_hex: node.color_hex,
      config_schema: node.config_schema,
      inputs: ioByNode[node.wsnd_id]?.inputs || [],
      outputs: ioByNode[node.wsnd_id]?.outputs || []
    }));

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: enrichedNodes
    });
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

// --- Admin CRUD for System Node Definitions ---

/**
 * List system node definitions for admin (paginated, optional status filter)
 */
exports.listSystemNodeDefinitionsAdmin = async function (req, res) {
  try {
    const rawQ = req.query.search;
    const search = rawQ != null && String(rawQ).trim() !== '' ? String(rawQ).trim() : null;
    // Only filter by status when explicitly 'active' or 'inactive'; otherwise return all
    const status =
      req.query.status === 'active' || req.query.status === 'inactive' ? req.query.status : null;
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const nodesRaw = await AiModelRegistryModel.listSystemNodeDefinitionsForAdmin(
      search,
      status,
      paginationParams.limit,
      paginationParams.offset
    );
    const nodes = nodesRaw.map(n => ({
      ...n,
      config_schema: parseJsonField(n.config_schema)
    }));
    return res.status(HTTP_STATUS_CODES.OK).json(nodes);
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

/**
 * Get single system node definition by id (with io_definitions and socket types)
 */
exports.getSystemNodeDefinitionById = async function (req, res) {
  try {
    const wsndId = req.params.wsndId;
    const rows = await AiModelRegistryModel.getSystemNodeDefinitionById(wsndId);
    const nodeRow = rows[0] || null;
    if (!nodeRow) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'System node definition not found' });
    }

    const node = {
      ...nodeRow,
      config_schema: parseJsonField(nodeRow.config_schema)
    };

    const [ioRows, socketTypes] = await Promise.all([
      AiModelRegistryModel.getSystemNodeIODefinitionsByNodeIds([wsndId]),
      AiModelRegistryModel.getAllSocketTypes()
    ]);
    const socketTypeMap = new Map(socketTypes.map(st => [st.amst_id, st]));
    node.io_definitions = ioRows.map(io => ({
      ...io,
      constraints: parseJsonField(io.constraints),
      socket_type: socketTypeMap.get(io.amst_id) || null
    }));

    return res.status(HTTP_STATUS_CODES.OK).json(node);
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

function prepareSystemNodeDefinitionPayload(body) {
  const data = {};
  if (body.type_slug !== undefined) data.type_slug = body.type_slug;
  if (body.name !== undefined) data.name = body.name;
  if (body.description !== undefined) data.description = body.description ?? null;
  if (body.icon !== undefined) data.icon = body.icon ?? null;
  if (body.color_hex !== undefined) data.color_hex = body.color_hex ?? null;
  if (body.config_schema !== undefined) {
    data.config_schema = typeof body.config_schema === 'object'
      ? JSON.stringify(body.config_schema)
      : (body.config_schema || '{}');
  }
  if (body.is_active !== undefined) data.is_active = body.is_active ? 1 : 0;
  return data;
}

/**
 * Create system node definition
 */
exports.createSystemNodeDefinition = async function (req, res) {
  try {
    const body = req.body;
    if (!body.type_slug || !body.name) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'type_slug and name are required' });
    }
    const data = prepareSystemNodeDefinitionPayload(body);
    const result = await AiModelRegistryModel.insertSystemNodeDefinition(data);
    const wsndId = result.insertId;

    await publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'WORKFLOW_SYSTEM_NODE_DEFINITIONS',
      actionName: 'CREATE_SYSTEM_NODE_DEFINITION',
      entityId: wsndId
    });

    const rows = await AiModelRegistryModel.getSystemNodeDefinitionById(wsndId);
    const created = rows[0] || null;
    if (!created) {
      return res.status(HTTP_STATUS_CODES.CREATED).json({ ...data, wsnd_id: wsndId });
    }
    const out = {
      ...created,
      config_schema: parseJsonField(created.config_schema)
    };
    return res.status(HTTP_STATUS_CODES.CREATED).json(out);
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

/**
 * Update system node definition
 */
exports.updateSystemNodeDefinition = async function (req, res) {
  try {
    const wsndId = req.params.wsndId;
    const existingRows = await AiModelRegistryModel.getSystemNodeDefinitionById(wsndId);
    if (!existingRows.length) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'System node definition not found' });
    }

    const data = prepareSystemNodeDefinitionPayload(req.body);
    if (Object.keys(data).length === 0) {
      const row = existingRows[0];
      return res.status(HTTP_STATUS_CODES.OK).json({
        ...row,
        config_schema: parseJsonField(row.config_schema)
      });
    }

    await AiModelRegistryModel.updateSystemNodeDefinition(wsndId, data);

    const isStatusOnly = Object.keys(data).length === 1 && Object.prototype.hasOwnProperty.call(data, 'is_active');
    await publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'WORKFLOW_SYSTEM_NODE_DEFINITIONS',
      actionName: isStatusOnly ? 'UPDATE_SYSTEM_NODE_DEFINITION_STATUS' : 'UPDATE_SYSTEM_NODE_DEFINITION',
      entityId: parseInt(wsndId, 10)
    });

    const rows = await AiModelRegistryModel.getSystemNodeDefinitionById(wsndId);
    const updated = rows[0] || null;
    if (!updated) {
      return res.status(HTTP_STATUS_CODES.OK).json({ wsnd_id: wsndId });
    }
    return res.status(HTTP_STATUS_CODES.OK).json({
      ...updated,
      config_schema: parseJsonField(updated.config_schema)
    });
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

function prepareSystemNodeIoPayload(body, wsndId) {
  const data = {
    wsnd_id: wsndId,
    amst_id: body.amst_id,
    direction: body.direction,
    name: body.name,
    label: body.label ?? body.name,
    is_required: body.is_required !== undefined ? (body.is_required ? 1 : 0) : 1,
    is_list: body.is_list ? 1 : 0,
    constraints: body.constraints != null
      ? (typeof body.constraints === 'string' ? body.constraints : JSON.stringify(body.constraints))
      : null,
    sort_order: body.sort_order ?? 0
  };
  return data;
}

/**
 * Create system node IO definition
 */
exports.createSystemNodeIoDefinition = async function (req, res) {
  try {
    const wsndId = parseInt(req.params.wsndId, 10);
    const body = req.body;
    if (!body.amst_id || !body.direction || !body.name) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'amst_id, direction and name are required' });
    }
    const data = prepareSystemNodeIoPayload(body, wsndId);
    const result = await AiModelRegistryModel.insertSystemNodeIoDefinition(data);
    const wsniodId = result.insertId;

    await publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'WORKFLOW_SYSTEM_NODE_IO_DEFINITIONS',
      actionName: 'CREATE_SYSTEM_NODE_IO_DEFINITION',
      entityId: wsniodId
    });

    const rows = await AiModelRegistryModel.getSystemNodeIoDefinitionById(wsniodId);
    const created = rows[0] || null;
    if (!created) {
      return res.status(HTTP_STATUS_CODES.CREATED).json({ wsniod_id: wsniodId, ...data });
    }
    return res.status(HTTP_STATUS_CODES.CREATED).json({
      ...created,
      constraints: parseJsonField(created.constraints)
    });
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

/**
 * Update system node IO definition
 */
exports.updateSystemNodeIoDefinition = async function (req, res) {
  try {
    const wsniodId = req.params.wsniodId;
    const body = req.body;
    const data = {};
    if (body.amst_id !== undefined) data.amst_id = body.amst_id;
    if (body.direction !== undefined) data.direction = body.direction;
    if (body.name !== undefined) data.name = body.name;
    if (body.label !== undefined) data.label = body.label;
    if (body.is_required !== undefined) data.is_required = body.is_required ? 1 : 0;
    if (body.is_list !== undefined) data.is_list = body.is_list ? 1 : 0;
    if (body.constraints !== undefined) {
      data.constraints = body.constraints != null
        ? (typeof body.constraints === 'string' ? body.constraints : JSON.stringify(body.constraints))
        : null;
    }
    if (body.sort_order !== undefined) data.sort_order = body.sort_order;

    if (Object.keys(data).length > 0) {
      await AiModelRegistryModel.updateSystemNodeIoDefinition(wsniodId, data);
      await publishNewAdminActivityLog({
        adminUserId: req.user.userId,
        entityType: 'WORKFLOW_SYSTEM_NODE_IO_DEFINITIONS',
        actionName: 'UPDATE_SYSTEM_NODE_IO_DEFINITION',
        entityId: parseInt(wsniodId, 10)
      });
    }

    const rows = await AiModelRegistryModel.getSystemNodeIoDefinitionById(wsniodId);
    const updated = rows[0] || null;
    if (!updated) {
      return res.status(HTTP_STATUS_CODES.OK).json({});
    }
    return res.status(HTTP_STATUS_CODES.OK).json({
      ...updated,
      constraints: parseJsonField(updated.constraints)
    });
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

/**
 * Delete system node IO definition
 */
exports.deleteSystemNodeIoDefinition = async function (req, res) {
  try {
    const wsniodId = req.params.wsniodId;
    await AiModelRegistryModel.deleteSystemNodeIoDefinition(wsniodId);
    await publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'WORKFLOW_SYSTEM_NODE_IO_DEFINITIONS',
      actionName: 'DELETE_SYSTEM_NODE_IO_DEFINITION',
      entityId: parseInt(wsniodId, 10)
    });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Deleted' });
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

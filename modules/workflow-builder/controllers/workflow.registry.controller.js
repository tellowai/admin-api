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
      version: model.version,
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
      version: node.version,
      status: node.status,
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
/**
 * List system node definitions for admin (paginated, optional status filter)
 */
exports.listSystemNodeDefinitionsAdmin = async function (req, res) {
  try {
    const rawQ = req.query.search;
    const search = rawQ != null && String(rawQ).trim() !== '' ? String(rawQ).trim() : null;
    const status = req.query.status && String(req.query.status).trim() !== '' ? String(req.query.status).trim() : null;
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
  if (body.status !== undefined) data.status = body.status;
  if (body.version !== undefined) data.version = body.version;
  // If explicitly archiving
  if (body.status === 'archived') {
    data.archived_at = new Date();
  }
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

    // Defaults
    if (!data.status) data.status = 'draft';
    if (!data.version) data.version = '1.0.0';

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
/**
 * Update system node definition (Versioning Support)
 */
exports.updateSystemNodeDefinition = async function (req, res) {
  try {
    const wsndId = req.params.wsndId;
    const updateData = { ...req.body };

    // Fetch existing node
    const existingRows = await AiModelRegistryModel.getSystemNodeDefinitionById(wsndId);
    if (!existingRows.length) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'System node definition not found' });
    }
    const existingNode = existingRows[0];

    // Check if status allows editing (only active and draft are editable)
    const editableStatuses = ['active', 'draft'];
    if (!editableStatuses.includes(existingNode.status)) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).send({
        message: `System nodes with status '${existingNode.status}' cannot be updated.`
      });
    }

    // Extract special fields
    const incomingIoDefinitions = updateData.io_definitions;
    delete updateData.io_definitions;

    // Prepare pure node data
    const nodeData = prepareSystemNodeDefinitionPayload(updateData);

    // Clean up readonly/immutable fields explicitly if they slipped past prepare
    delete nodeData.wsnd_id;
    delete nodeData.created_at;
    delete nodeData.updated_at;

    // --- VERSIONING CHECK ---
    let needsVersioning = false;

    // Versioning only applies if the node is already ACTIVE. 
    // Draft nodes can change params/IO without bumping version.
    if (existingNode.status === 'active') {

      // 1. Check Config Schema Change
      if (nodeData.config_schema) {
        const newSchemaStr = typeof nodeData.config_schema === 'string'
          ? nodeData.config_schema
          : JSON.stringify(nodeData.config_schema);

        const existingSchemaStr = typeof existingNode.config_schema === 'string'
          ? existingNode.config_schema
          : JSON.stringify(existingNode.config_schema || {});

        // Compare non-empty schemas
        if (newSchemaStr !== existingSchemaStr) {
          if (newSchemaStr !== '{}' || existingSchemaStr !== '{}') {
            needsVersioning = true;
          }
        }
      }

      // 2. Check IO Definition Change - IF provided
      if (!needsVersioning && incomingIoDefinitions) {
        const existingIos = await AiModelRegistryModel.getSystemNodeIODefinitionsByNodeIds([wsndId]);

        const scrub = (list) => {
          if (!Array.isArray(list)) return [];
          const sorted = [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

          return sorted.map(i => {
            const { wsniod_id, wsnd_id, updated_at, created_at, socket_type, amst_id, ...rest } = i;
            // Normalization
            if (rest.is_required !== undefined) rest.is_required = rest.is_required ? 1 : 0;
            if (rest.is_list !== undefined) rest.is_list = rest.is_list ? 1 : 0;
            if (rest.sort_order !== undefined) rest.sort_order = parseInt(rest.sort_order, 10) || 0;
            if (rest.constraints !== undefined) {
              // constraint object serialization
              const c = typeof rest.constraints === 'string' ? JSON.parse(rest.constraints || '{}') : (rest.constraints || {});
              const sortedKeys = Object.keys(c).sort().reduce((acc, k) => { acc[k] = c[k]; return acc; }, {});
              rest.constraints = JSON.stringify(sortedKeys);
            }
            // For checking equivalent semantic logic, we might ignore amst_id if the socket type *name* is what defines it, 
            // but usually amst_id change means type change. However, incoming might just have IDs.
            // Let's rely on matching rest of props. 
            // If amst_id is present in both, compare it.
            if (amst_id !== undefined) rest.amst_id = amst_id;

            return rest;
          });
        };

        const cur = JSON.stringify(scrub(existingIos));
        const incoming = JSON.stringify(scrub(incomingIoDefinitions));

        if (cur !== incoming) {
          needsVersioning = true;
        }
      }
    }

    if (needsVersioning) {
      // --- VERSION BUMP FLOW ---

      // 1. Deprecate Old Node
      await AiModelRegistryModel.updateSystemNodeDefinition(wsndId, { status: 'deprecated' });

      // 2. Compute New Version
      const oldVersion = existingNode.version || '1.0.0';
      const parts = oldVersion.replace(/[^0-9.]/g, '').split('.');
      // Patch increment
      if (parts.length >= 3) {
        parts[2] = parseInt(parts[2], 10) + 1;
      } else {
        parts.push('1');
      }
      const newVersion = parts.slice(0, 3).join('.');

      // 3. Prepare New Node Data
      const newNodeData = {
        ...existingNode,
        ...nodeData, // Overwrites with updates
        version: newVersion,
        status: 'active',
        wsnd_id: undefined,
        created_at: undefined,
        updated_at: undefined,
        // Ensure dates are reset or handled by DB default
        archived_at: null
      };

      // 4. Create New Node
      const result = await AiModelRegistryModel.insertSystemNodeDefinition(newNodeData);
      const newWsndId = result.insertId;

      // 5. Clone/Create IO Definitions
      let iosToCreate = incomingIoDefinitions;
      if (!iosToCreate) {
        // Copy from old
        iosToCreate = await AiModelRegistryModel.getSystemNodeIODefinitionsByNodeIds([wsndId]);
      }

      if (iosToCreate && iosToCreate.length > 0) {
        for (const io of iosToCreate) {
          // Prepare io payload compatible with insertSystemNodeIoDefinition
          const ioData = prepareSystemNodeIoPayload(io, newWsndId);
          await AiModelRegistryModel.insertSystemNodeIoDefinition(ioData);
        }
      }

      await publishNewAdminActivityLog({
        adminUserId: req.user.userId,
        entityType: 'WORKFLOW_SYSTEM_NODE_DEFINITIONS',
        actionName: 'VERSION_BUMP_SYSTEM_NODE',
        entityId: newWsndId,
        details: `Upgraded from ${wsndId} (${oldVersion}) to ${newWsndId} (${newVersion})`
      });

      return res.status(HTTP_STATUS_CODES.OK).json({
        message: 'System node upgraded to new version',
        new_wsnd_id: newWsndId,
        version: newVersion
      });

    } else {
      // --- NORMAL UPDATE ---

      // We only update the Node definition here. 
      // If IO definitions are provided for a Draft/Active (no version bump needed) node, 
      // we should technically sync them, but the current UI pattern usually splits them unless we strictly enforce "Save All".
      // To strictly follow "Do same as AI models":

      if (incomingIoDefinitions && existingNode.status === 'draft') {
        // Full Sync for Draft: Delete all existing IOs and Re-create
        // This is safer than diffing for drafts to ensure 1:1 match
        const existingIos = await AiModelRegistryModel.getSystemNodeIODefinitionsByNodeIds([wsndId]);
        for (const io of existingIos) {
          await AiModelRegistryModel.deleteSystemNodeIoDefinition(io.wsniod_id);
        }
        for (const io of incomingIoDefinitions) {
          const ioData = prepareSystemNodeIoPayload(io, wsndId);
          await AiModelRegistryModel.insertSystemNodeIoDefinition(ioData);
        }
      }

      if (Object.keys(nodeData).length > 0) {
        await AiModelRegistryModel.updateSystemNodeDefinition(wsndId, nodeData);
      }

      const isStatusOnly = Object.keys(nodeData).length === 1 && Object.prototype.hasOwnProperty.call(nodeData, 'status');
      const actionName = isStatusOnly ? 'UPDATE_SYSTEM_NODE_DEFINITION_STATUS' : 'UPDATE_SYSTEM_NODE_DEFINITION';

      await publishNewAdminActivityLog({
        adminUserId: req.user.userId,
        entityType: 'WORKFLOW_SYSTEM_NODE_DEFINITIONS',
        actionName,
        entityId: parseInt(wsndId, 10)
      });

      const rows = await AiModelRegistryModel.getSystemNodeDefinitionById(wsndId);
      const updated = rows[0] || null;
      return res.status(HTTP_STATUS_CODES.OK).json({
        ...updated,
        config_schema: parseJsonField(updated ? updated.config_schema : null)
      });
    }

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
 * Helper to check capability to edit IO (Draft Only)
 */
async function ensureDraftStatusForIoEdit(wsndId, res) {
  const rows = await AiModelRegistryModel.getSystemNodeDefinitionById(wsndId);
  if (!rows.length || rows[0].status !== 'draft') {
    res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'IO definitions can only be directly edited for DRAFT nodes. For Active nodes, please update the parent node to trigger versioning.' });
    return false;
  }
  return true;
}

/**
 * Create system node IO definition
 * Restricted to DRAFT nodes.
 */
exports.createSystemNodeIoDefinition = async function (req, res) {
  try {
    const wsndId = parseInt(req.params.wsndId, 10);
    if (!(await ensureDraftStatusForIoEdit(wsndId, res))) return;

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
 * Restricted to DRAFT nodes.
 */
exports.updateSystemNodeIoDefinition = async function (req, res) {
  try {
    const wsniodId = req.params.wsniodId;

    // Reverse lookup to check parent status
    // Note: This requires a new model method or two queries. 
    // For now, let's assume we can fetch IO then fetch Node.
    const ioRows = await AiModelRegistryModel.getSystemNodeIoDefinitionById(wsniodId);
    if (!ioRows.length) return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'IO not found' });

    const wsndId = ioRows[0].wsnd_id;
    if (!(await ensureDraftStatusForIoEdit(wsndId, res))) return;

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
 * Restricted to DRAFT nodes.
 */
exports.deleteSystemNodeIoDefinition = async function (req, res) {
  try {
    const wsniodId = req.params.wsniodId;
    // Reverse lookup
    const ioRows = await AiModelRegistryModel.getSystemNodeIoDefinitionById(wsniodId);
    if (!ioRows.length) return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'IO not found' });
    const wsndId = ioRows[0].wsnd_id;

    if (!(await ensureDraftStatusForIoEdit(wsndId, res))) return;

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

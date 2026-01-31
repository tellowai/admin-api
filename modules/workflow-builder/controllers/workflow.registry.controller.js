'use strict';

const AiModelRegistryModel = require('../models/ai-model-registry.model');
const WorkflowErrorHandler = require('../middlewares/workflow.error.handler');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

/**
 * List active AI models for the node library
 */
exports.listActiveModels = async function (req, res) {
  try {
    const { q } = req.query;
    const models = await AiModelRegistryModel.listActiveModels(q);

    if (models.length === 0) {
      return res.status(HTTP_STATUS_CODES.OK).json({ data: [] });
    }

    // Collect IDs for batch fetching
    const modelIds = models.map(m => m.amr_id);
    const providerIds = [...new Set(models.map(m => m.amp_id).filter(Boolean))];

    // Single parallel batch: I/O definitions, providers, ALL socket types
    const [ioDefinitions, providers, socketTypes] = await Promise.all([
      AiModelRegistryModel.getIODefinitionsByModelIds(modelIds),
      AiModelRegistryModel.getProvidersByIds(providerIds),
      AiModelRegistryModel.getAllSocketTypes()
    ]);

    // Create lookup maps (O(1) access)
    const providerMap = new Map(providers.map(p => [p.amp_id, p]));
    const socketTypeMap = new Map(socketTypes.map(st => [st.amst_id, st]));

    // Group IO definitions by model ID (single pass)
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

    // Stitch data (single pass)
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

    // Sort by name
    enrichedModels.sort((a, b) => a.name.localeCompare(b.name));

    return res.status(HTTP_STATUS_CODES.OK).json({ data: enrichedModels });
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

/**
 * Get socket types
 */
exports.listSocketTypes = async function (req, res) {
  // TODO: Implement calling a model/service to get socket types
  // Returning empty or mocked for now as model method wasn't explicitly in plan snippets
  return res.status(HTTP_STATUS_CODES.OK).json({
    data: []
  });
};

/**
 * Get system nodes
 */
exports.listSystemNodes = async function (req, res) {
  try {
    const { q } = req.query;
    const nodes = await AiModelRegistryModel.listSystemNodeDefinitions(q);

    if (nodes.length === 0) {
      return res.status(HTTP_STATUS_CODES.OK).json({ data: [] });
    }

    const nodeIds = nodes.map(n => n.wsnd_id);

    // Parallel fetch: IO definitions and socket types
    const [ioDefinitions, socketTypes] = await Promise.all([
      AiModelRegistryModel.getSystemNodeIODefinitionsByNodeIds(nodeIds),
      AiModelRegistryModel.getAllSocketTypes()
    ]);

    const socketTypeMap = new Map(socketTypes.map(st => [st.amst_id, st]));

    // Group IO definitions by node ID
    const ioByNode = {};
    for (const io of ioDefinitions) {
      if (!ioByNode[io.wsnd_id]) {
        ioByNode[io.wsnd_id] = { inputs: [], outputs: [] };
      }
      const socketType = socketTypeMap.get(io.amst_id);
      const ioDef = {
        name: io.name,
        label: io.label || io.name,
        type: socketType?.slug?.toLowerCase() || 'text', // Use slug for frontend matching (e.g. 'image', 'text')
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

    // Enrich nodes
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

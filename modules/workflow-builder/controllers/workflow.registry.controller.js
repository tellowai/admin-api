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
    const categoryIds = [...new Set(models.map(m => m.amc_id).filter(Boolean))];

    // Single parallel batch: I/O definitions, providers, categories, ALL socket types
    // Socket types is a small lookup table (~6 rows), fetch all is cheaper than sequential call
    const [ioDefinitions, providers, categories, socketTypes] = await Promise.all([
      AiModelRegistryModel.getIODefinitionsByModelIds(modelIds),
      AiModelRegistryModel.getProvidersByIds(providerIds),
      AiModelRegistryModel.getCategoriesByIds(categoryIds),
      AiModelRegistryModel.getAllSocketTypes()
    ]);

    // Create lookup maps (O(1) access)
    const providerMap = new Map(providers.map(p => [p.amp_id, p]));
    const categoryMap = new Map(categories.map(c => [c.amc_id, c]));
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
      slug: model.slug,
      description: model.description,
      icon_url: model.icon_url,
      provider_name: providerMap.get(model.amp_id)?.name || null,
      category_name: categoryMap.get(model.amc_id)?.name || null,
      category_color: categoryMap.get(model.amc_id)?.color_hex || null,
      inputs: ioByModel[model.amr_id]?.inputs || [],
      outputs: ioByModel[model.amr_id]?.outputs || [],
      parameter_schema: model.parameter_schema,
      pricing_config: model.pricing_config
    }));

    // Sort by category sort_order
    enrichedModels.sort((a, b) => {
      const orderA = categoryMap.get(models.find(m => m.name === a.name)?.amc_id)?.sort_order || 999;
      const orderB = categoryMap.get(models.find(m => m.name === b.name)?.amc_id)?.sort_order || 999;
      return orderA !== orderB ? orderA - orderB : a.name.localeCompare(b.name);
    });

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
    return res.status(HTTP_STATUS_CODES.OK).json({
      data: nodes
    });
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

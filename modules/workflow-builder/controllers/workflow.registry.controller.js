'use strict';

const AiModelRegistryModel = require('../models/ai-model-registry.model');
const WorkflowErrorHandler = require('../middlewares/workflow.error.handler');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

/**
 * List active AI models for the node library
 */
exports.listActiveModels = async function (req, res) {
  try {
    const models = await AiModelRegistryModel.listActiveModels();

    // Collect IDs for batch fetching
    const providerIds = [...new Set(models.map(m => m.amp_id).filter(id => id))];
    const categoryIds = [...new Set(models.map(m => m.amc_id).filter(id => id))];

    // Batch fetch in parallel
    const [providers, categories] = await Promise.all([
      AiModelRegistryModel.getProvidersByIds(providerIds),
      AiModelRegistryModel.getCategoriesByIds(categoryIds)
    ]);

    // Create maps
    const providerMap = new Map(providers.map(p => [p.amp_id, p]));
    const categoryMap = new Map(categories.map(c => [c.amc_id, c]));

    // Stitch data
    const enrichedModels = models.map(model => ({
      ...model,
      provider_name: providerMap.get(model.amp_id)?.name || null,
      category_name: categoryMap.get(model.amc_id)?.name || null,
      category_color: categoryMap.get(model.amc_id)?.color_hex || null
    }));

    // Sort by category sort_order manually since we removed JOIN order
    enrichedModels.sort((a, b) => {
      const orderA = categoryMap.get(a.amc_id)?.sort_order || 999;
      const orderB = categoryMap.get(b.amc_id)?.sort_order || 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: enrichedModels
    });
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
    const nodes = await AiModelRegistryModel.listSystemNodeDefinitions();
    return res.status(HTTP_STATUS_CODES.OK).json({
      data: nodes
    });
  } catch (error) {
    WorkflowErrorHandler.handleWorkflowErrors(error, res);
  }
};

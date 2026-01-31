'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * Get I/O definitions for a single model (convenience wrapper)
 */
exports.getIODefinitionsByModelId = async function (modelId) {
  if (modelId == null) return [];
  const rows = await exports.getIODefinitionsByModelIds([modelId]);
  return rows;
};

/**
 * Get I/O definitions for multiple models (No JOINs, batch operation)
 */
exports.getIODefinitionsByModelIds = async function (modelIds) {
  if (!modelIds || modelIds.length === 0) return [];

  const query = `
    SELECT 
      amiod_id,
      amr_id,
      amst_id,
      direction,
      name,
      label,
      description,
      is_required,
      is_list,
      default_value,
      constraints,
      sort_order
    FROM ai_model_io_definitions
    WHERE amr_id IN (?)
    ORDER BY amr_id, sort_order ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [modelIds]);
};

/**
 * List all active AI models (No JOINs)
 */
exports.listActiveModels = async function (searchQuery = null) {
  let query = `
    SELECT 
      amr_id,
      amp_id,
      name,
      version,
      description,
      icon_url,
      parameter_schema,
      pricing_config
    FROM ai_model_registry
    WHERE is_active = TRUE AND archived_at IS NULL
  `;

  const params = [];
  if (searchQuery) {
    query += ` AND (LOWER(name) LIKE ? OR LOWER(platform_model_id) LIKE ?) `;
    const term = `%${searchQuery.toLowerCase()}%`;
    params.push(term, term);
  }

  query += ` ORDER BY updated_at DESC `;

  const results = await mysqlQueryRunner.runQueryInSlave(query, params);

  // Parse JSON fields
  return results.map(model => {
    if (model.parameter_schema && typeof model.parameter_schema === 'string') {
      try { model.parameter_schema = JSON.parse(model.parameter_schema); } catch (e) { }
    }
    if (model.pricing_config && typeof model.pricing_config === 'string') {
      try { model.pricing_config = JSON.parse(model.pricing_config); } catch (e) { }
    }
    return model;
  });
};

// Batch fetch helpers

/**
 * Get socket types by IDs
 */
exports.getSocketTypesByIds = async function (ids) {
  if (!ids || ids.length === 0) return [];
  const query = `SELECT amst_id, name, color_hex FROM ai_model_socket_types WHERE amst_id IN (?)`;
  return await mysqlQueryRunner.runQueryInSlave(query, [ids]);
};

/**
 * Get ALL socket types (small lookup table, ~6 rows)
 */
exports.getAllSocketTypes = async function () {
  const query = `SELECT amst_id, name, slug, color_hex FROM ai_model_socket_types`;
  return await mysqlQueryRunner.runQueryInSlave(query);
};

/**
 * Get providers by IDs
 */
exports.getProvidersByIds = async function (ids) {
  if (!ids || ids.length === 0) return [];
  const query = `SELECT amp_id, name FROM ai_model_providers WHERE amp_id IN (?)`;
  return await mysqlQueryRunner.runQueryInSlave(query, [ids]);
};

/**
 * Get categories by IDs
 */
exports.getCategoriesByIds = async function (ids) {
  if (!ids || ids.length === 0) return [];
  const query = `SELECT amc_id, name, color_hex, sort_order FROM ai_model_categories WHERE amc_id IN (?)`;
  return await mysqlQueryRunner.runQueryInSlave(query, [ids]);
};

/**
 * List active system node definitions
 */
exports.listSystemNodeDefinitions = async function (searchQuery = null) {
  let query = `
    SELECT 
      wsnd_id,
      type_slug,
      name,
      description,
      icon,
      color_hex,
      config_schema
    FROM workflow_system_node_definitions
    WHERE is_active = TRUE
  `;

  const params = [];
  if (searchQuery) {
    query += ` AND (LOWER(name) LIKE ? OR LOWER(type_slug) LIKE ?) `;
    const term = `%${searchQuery.toLowerCase()}%`;
    params.push(term, term);
  }

  query += ` ORDER BY updated_at DESC `;

  const results = await mysqlQueryRunner.runQueryInSlave(query, params);

  return results.map(node => {
    if (node.config_schema && typeof node.config_schema === 'string') {
      try { node.config_schema = JSON.parse(node.config_schema); } catch (e) { }
    }
    return node;
  });
};

/**
 * Get I/O definitions for multiple system nodes
 */
exports.getSystemNodeIODefinitionsByNodeIds = async function (nodeIds) {
  if (!nodeIds || nodeIds.length === 0) return [];

  const query = `
    SELECT 
      wsniod_id,
      wsnd_id,
      amst_id,
      direction,
      name,
      label,
      is_required,
      is_list,
      sort_order
    FROM workflow_system_node_io_definitions
    WHERE wsnd_id IN (?)
    ORDER BY wsnd_id, sort_order ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [nodeIds]);
};

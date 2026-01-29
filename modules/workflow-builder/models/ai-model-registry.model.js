'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * Get I/O definitions for a specific model (No JOINs)
 */
exports.getIODefinitionsByModelId = async function (modelId) {
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
    WHERE amr_id = ?
    ORDER BY sort_order ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [modelId]);
};

/**
 * List all active AI models (No JOINs)
 */
exports.listActiveModels = async function () {
  const query = `
    SELECT 
      amr_id,
      amp_id,
      amc_id,
      name,
      slug,
      version,
      description,
      icon_url,
      parameter_schema,
      pricing_config
    FROM ai_model_registry
    WHERE is_active = TRUE AND archived_at IS NULL
    ORDER BY name
  `;

  const results = await mysqlQueryRunner.runQueryInSlave(query, []);

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
 * Get providers by IDs
 */
exports.getProvidersByIds = async function (ids) {
  if (!ids || ids.length === 0) return [];
  const query = `SELECT amp_id, name, logo_url FROM ai_model_providers WHERE amp_id IN (?)`;
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
exports.listSystemNodeDefinitions = async function () {
  const query = `
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
    ORDER BY name ASC
  `;
  const results = await mysqlQueryRunner.runQueryInSlave(query, []);

  return results.map(node => {
    if (node.config_schema && typeof node.config_schema === 'string') {
      try { node.config_schema = JSON.parse(node.config_schema); } catch (e) { }
    }
    return node;
  });
};

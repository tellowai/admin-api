'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * Get I/O definitions for a single model (convenience: one query with single id)
 */
exports.getIODefinitionsByModelId = async function (modelId) {
  if (modelId == null) return [];
  return exports.getIODefinitionsByModelIds([modelId]);
};

/**
 * Get I/O definitions for multiple models. Single query. Returns raw rows.
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
 * List active AI models with pagination. Single query. Returns raw rows.
 */
exports.listActiveModels = async function (searchQuery = null, limit = 20, offset = 0) {
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
    WHERE status = 'active' AND archived_at IS NULL
  `;

  const params = [];
  if (searchQuery) {
    query += ` AND (LOWER(name) LIKE ? OR LOWER(platform_model_id) LIKE ?) `;
    const term = `%${searchQuery.toLowerCase()}%`;
    params.push(term, term);
  }

  query += ` ORDER BY updated_at DESC LIMIT ? OFFSET ? `;
  params.push(limit, offset);

  return await mysqlQueryRunner.runQueryInSlave(query, params);
};

/**
 * Get AI model registry rows by amr_id. Single query. Returns raw rows.
 */
exports.getByAmrIds = async function (amrIds) {
  if (!amrIds || amrIds.length === 0) return [];

  const unique = [...new Set(amrIds)].filter(id => id != null);
  if (unique.length === 0) return [];

  const placeholders = unique.map(() => '?').join(',');
  const query = `
    SELECT 
      amr_id,
      name,
      platform_model_id,
      version,
      description,
      icon_url
    FROM ai_model_registry
    WHERE amr_id IN (${placeholders})
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, unique);
};

/**
 * Get AI model registry rows by amr_id including parameter_schema (for workflow node enrichment).
 * Single query. Returns raw rows.
 */
exports.getByAmrIdsWithParameterSchema = async function (amrIds) {
  if (!amrIds || amrIds.length === 0) return [];

  const unique = [...new Set(amrIds)].filter(id => id != null);
  if (unique.length === 0) return [];

  const placeholders = unique.map(() => '?').join(',');
  const query = `
    SELECT 
      amr_id,
      amp_id,
      name,
      platform_model_id,
      version,
      description,
      icon_url,
      parameter_schema,
      pricing_config
    FROM ai_model_registry
    WHERE amr_id IN (${placeholders})
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, unique);
};

/**
 * Get socket types by IDs. Single query. Returns raw rows.
 */
exports.getSocketTypesByIds = async function (ids) {
  if (!ids || ids.length === 0) return [];
  const query = `SELECT amst_id, name, color_hex FROM ai_model_socket_types WHERE amst_id IN (?)`;
  return await mysqlQueryRunner.runQueryInSlave(query, [ids]);
};

/**
 * Get all socket types. Single query. Returns raw rows.
 */
exports.getAllSocketTypes = async function () {
  const query = `SELECT amst_id, name, slug, color_hex FROM ai_model_socket_types`;
  return await mysqlQueryRunner.runQueryInSlave(query);
};

/**
 * Get providers by IDs. Single query. Returns raw rows.
 */
exports.getProvidersByIds = async function (ids) {
  if (!ids || ids.length === 0) return [];
  const query = `SELECT amp_id, name FROM ai_model_providers WHERE amp_id IN (?)`;
  return await mysqlQueryRunner.runQueryInSlave(query, [ids]);
};

/**
 * Get categories by IDs. Single query. Returns raw rows.
 */
exports.getCategoriesByIds = async function (ids) {
  if (!ids || ids.length === 0) return [];
  const query = `SELECT amc_id, name, color_hex, sort_order FROM ai_model_categories WHERE amc_id IN (?)`;
  return await mysqlQueryRunner.runQueryInSlave(query, [ids]);
};

/**
 * List active system node definitions with pagination. Single query. Returns raw rows.
 */
/**
 * List active system node definitions with pagination. Single query. Returns raw rows.
 */
exports.listSystemNodeDefinitions = async function (searchQuery = null, limit = 20, offset = 0) {
  let query = `
    SELECT 
      wsnd_id,
      type_slug,
      name,
      status,
      version,
      description,
      icon,
      color_hex,
      config_schema
    FROM workflow_system_node_definitions
    WHERE status = 'active'
  `;

  const params = [];
  if (searchQuery) {
    query += ` AND (LOWER(name) LIKE ? OR LOWER(type_slug) LIKE ?) `;
    const term = `%${searchQuery.toLowerCase()}%`;
    params.push(term, term);
  }

  query += ` ORDER BY updated_at DESC LIMIT ? OFFSET ? `;
  params.push(limit, offset);

  return await mysqlQueryRunner.runQueryInSlave(query, params);
};

/**
 * Get I/O definitions for multiple system nodes. Single query. Returns raw rows.
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
      constraints,
      sort_order
    FROM workflow_system_node_io_definitions
    WHERE wsnd_id IN (?)
    ORDER BY wsnd_id, sort_order ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [nodeIds]);
};

/**
 * List system node definitions for admin. Single query. Returns raw rows.
 */
exports.listSystemNodeDefinitionsForAdmin = async function (searchQuery = null, status = null, limit = 20, offset = 0) {
  let query = `
    SELECT 
      wsnd_id,
      type_slug,
      name,
      description,
      icon,
      color_hex,
      config_schema,
      status,
      version,
      archived_at,
      created_at,
      updated_at
    FROM workflow_system_node_definitions
    WHERE 1=1
  `;

  const params = [];
  if (searchQuery) {
    query += ` AND (LOWER(name) LIKE ? OR LOWER(type_slug) LIKE ?) `;
    const term = `%${searchQuery.toLowerCase()}%`;
    params.push(term, term);
  }
  if (status) {
    query += ` AND status = ? `;
    params.push(status);
  }

  query += ` ORDER BY updated_at DESC LIMIT ? OFFSET ? `;
  params.push(limit, offset);

  return await mysqlQueryRunner.runQueryInSlave(query, params);
};

/**
 * Get single system node definition by id. Single query. Returns raw rows (array).
 */
exports.getSystemNodeDefinitionById = async function (wsndId) {
  const query = `
    SELECT 
      wsnd_id,
      type_slug,
      name,
      description,
      icon,
      color_hex,
      config_schema,
      status,
      version,
      archived_at,
      created_at,
      updated_at
    FROM workflow_system_node_definitions
    WHERE wsnd_id = ?
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, [wsndId]);
};

/**
 * Get system node definitions by ids (for enriching workflow GET response). Active only.
 * @param {number[]} wsndIds - wsnd_id list
 * @returns {Promise<Array>} Raw rows with wsnd_id, type_slug, name, icon, color_hex, config_schema, etc.
 */
exports.getSystemNodeDefinitionsByIds = async function (wsndIds) {
  if (!wsndIds || wsndIds.length === 0) return [];
  const unique = [...new Set(wsndIds)].filter(id => id != null);
  const placeholders = unique.map(() => '?').join(', ');
  const query = `
    SELECT 
      wsnd_id,
      type_slug,
      name,
      description,
      icon,
      color_hex,
      config_schema,
      version
    FROM workflow_system_node_definitions
    WHERE wsnd_id IN (${placeholders})
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, unique);
};

/**
 * Insert system node definition. Single query. Returns result (e.g. insertId).
 * Caller must pass DB-ready values (config_schema as string, is_active as 0|1).
 */
exports.insertSystemNodeDefinition = async function (data) {
  const columns = Object.keys(data);
  const placeholders = columns.map(() => '?').join(', ');
  const values = Object.values(data);

  const query = `
    INSERT INTO workflow_system_node_definitions (${columns.join(', ')})
    VALUES (${placeholders})
  `;
  return await mysqlQueryRunner.runQueryInMaster(query, values);
};

/**
 * Update system node definition. Single query. Caller passes DB-ready field values.
 */
exports.updateSystemNodeDefinition = async function (wsndId, data) {
  if (!data || Object.keys(data).length === 0) return;

  const setClause = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(data), wsndId];
  const query = `UPDATE workflow_system_node_definitions SET ${setClause} WHERE wsnd_id = ?`;
  await mysqlQueryRunner.runQueryInMaster(query, values);
};

/**
 * Insert system node IO definition. Single query. Returns result (e.g. insertId).
 * Caller must pass DB-ready values.
 */
exports.insertSystemNodeIoDefinition = async function (data) {
  const columns = Object.keys(data);
  const placeholders = columns.map(() => '?').join(', ');
  const values = Object.values(data);

  const query = `
    INSERT INTO workflow_system_node_io_definitions (${columns.join(', ')})
    VALUES (${placeholders})
  `;
  return await mysqlQueryRunner.runQueryInMaster(query, values);
};

/**
 * Get single system node IO definition by id. Single query. Returns raw rows (array).
 */
exports.getSystemNodeIoDefinitionById = async function (wsniodId) {
  const query = `
    SELECT wsniod_id, wsnd_id, amst_id, direction, name, label, is_required, is_list, constraints, sort_order
    FROM workflow_system_node_io_definitions
    WHERE wsniod_id = ?
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, [wsniodId]);
};

/**
 * Update system node IO definition. Single query. Caller passes DB-ready field values.
 */
exports.updateSystemNodeIoDefinition = async function (wsniodId, data) {
  if (!data || Object.keys(data).length === 0) return;

  const setClause = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(data), wsniodId];
  const query = `UPDATE workflow_system_node_io_definitions SET ${setClause} WHERE wsniod_id = ?`;
  await mysqlQueryRunner.runQueryInMaster(query, values);
};

/**
 * Delete system node IO definition. Single query.
 */
exports.deleteSystemNodeIoDefinition = async function (wsniodId) {
  const query = `DELETE FROM workflow_system_node_io_definitions WHERE wsniod_id = ?`;
  await mysqlQueryRunner.runQueryInMaster(query, [wsniodId]);
};

/**
 * Get system node definitions by type_slugs (for enriching workflow GET response). Active only.
 * @param {string[]} slugs - type_slug list
 * @returns {Promise<Array>} Raw rows with wsnd_id, type_slug, name, icon, color_hex, config_schema, etc.
 */
exports.getSystemNodeDefinitionsBySlugs = async function (slugs) {
  if (!slugs || slugs.length === 0) return [];
  const unique = [...new Set(slugs)].filter(s => s != null);
  if (unique.length === 0) return [];

  const placeholders = unique.map(() => '?').join(', ');
  const query = `
    SELECT 
      wsnd_id,
      type_slug,
      name,
      description,
      icon,
      color_hex,
      config_schema,
      version
    FROM workflow_system_node_definitions
    WHERE type_slug IN (${placeholders}) AND status = 'active'
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, unique);
};


'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * List AI Models (V2) from ai_model_registry
 */
exports.listAiModels = async function (searchParams = {}, paginationParams = null) {
  let query = `
    SELECT 
      amr_id,
      amp_id,
      name,
      platform_model_id,
      version,
      description,
      status,
      circuit_state,
      fallback_amr_id,
      fallback_mapping,
      parameter_schema,
      pricing_config,
      icon_url,
      documentation_url,
      created_at,
      updated_at
    FROM ai_model_registry
    WHERE archived_at IS NULL
  `;

  const queryParams = [];
  const conditions = [];

  // Search by name
  if (searchParams.search) {
    conditions.push(`(LOWER(name) LIKE LOWER(?) OR LOWER(platform_model_id) LIKE LOWER(?))`);
    queryParams.push(`%${searchParams.search}%`, `%${searchParams.search}%`);
  }

  // Filter by Provider
  if (searchParams.amp_id) {
    conditions.push(`amp_id = ?`);
    queryParams.push(searchParams.amp_id);
  }

  // Filter by Status (active / inactive / or specific enum: deprecated, disabled, archived)
  if (searchParams.status) {
    if (searchParams.status === 'active') conditions.push(`status = 'active'`);
    else if (searchParams.status === 'inactive') conditions.push(`status != 'active'`);
    else {
      conditions.push(`status = ?`);
      queryParams.push(searchParams.status);
    }
  }

  if (conditions.length > 0) {
    query += ` AND ${conditions.join(' AND ')}`;
  }

  // Sorting (most recently updated first, then newest ID)
  query += ` ORDER BY updated_at DESC, amr_id DESC`;

  // Pagination
  if (paginationParams) {
    query += ` LIMIT ? OFFSET ?`;
    queryParams.push(paginationParams.limit, paginationParams.offset);
  }

  return await mysqlQueryRunner.runQueryInSlave(query, queryParams);
};

/**
 * Create a new AI Model
 */
exports.createAiModel = async function (data) {
  const processedData = {
    ...data,
    parameter_schema: data.parameter_schema ? JSON.stringify(data.parameter_schema) : '{}',
    pricing_config: data.pricing_config ? JSON.stringify(data.pricing_config) : '{}',
    fallback_mapping: data.fallback_mapping != null ? JSON.stringify(data.fallback_mapping) : null,
    created_at: new Date(),
    updated_at: new Date()
  };

  const columns = Object.keys(processedData);
  const placeholders = columns.map(() => '?').join(', ');
  const values = Object.values(processedData);

  const query = `
    INSERT INTO ai_model_registry (${columns.join(', ')})
    VALUES (${placeholders})
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, values);
};

/**
 * Get AI Model by ID
 */
exports.getAiModelById = async function (amrId) {
  const query = `
    SELECT * FROM ai_model_registry 
    WHERE amr_id = ? AND archived_at IS NULL
  `;
  const results = await mysqlQueryRunner.runQueryInSlave(query, [amrId]);
  return results[0] || null;
};

/**
 * Update AI Model
 */
exports.updateAiModel = async function (amrId, data) {
  const processedData = {};
  Object.keys(data).forEach(key => {
    if (['parameter_schema', 'pricing_config', 'fallback_mapping'].includes(key)) {
      processedData[key] = data[key] != null && typeof data[key] === 'object' ? JSON.stringify(data[key]) : data[key];
    } else {
      processedData[key] = data[key];
    }
  });

  const setClause = Object.keys(processedData).map(key => `${key} = ?`).join(', ');
  const values = [...Object.values(processedData), amrId];

  const query = `
    UPDATE ai_model_registry
    SET ${setClause}
    WHERE amr_id = ?
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, values);
};

// --- Providers ---

exports.listProviders = async function () {
  const query = `SELECT * FROM ai_model_providers WHERE is_active = 1 ORDER BY name ASC`;
  return await mysqlQueryRunner.runQueryInSlave(query, []);
};

exports.getProvidersByIds = async function (ids) {
  if (!ids || ids.length === 0) return [];
  const query = `SELECT * FROM ai_model_providers WHERE amp_id IN (?)`;
  return await mysqlQueryRunner.runQueryInSlave(query, [ids]);
};

exports.getProviderById = async function (ampId) {
  const query = `SELECT * FROM ai_model_providers WHERE amp_id = ?`;
  const result = await mysqlQueryRunner.runQueryInSlave(query, [ampId]);
  return result[0];
};

exports.createProvider = async function (data) {
  const processedData = {
    ...data,
    auth_config: data.auth_config ? JSON.stringify(data.auth_config) : '{}'
  };

  const columns = Object.keys(processedData);
  const placeholders = columns.map(() => '?').join(', ');
  const values = Object.values(processedData);

  const query = `INSERT INTO ai_model_providers (${columns.join(', ')}) VALUES (${placeholders})`;
  return await mysqlQueryRunner.runQueryInMaster(query, values);
};

exports.updateProvider = async function (ampId, data) {
  const processedData = {};
  Object.keys(data).forEach(key => {
    if (key === 'auth_config') {
      processedData[key] = typeof data[key] === 'object' ? JSON.stringify(data[key]) : data[key];
    } else {
      processedData[key] = data[key];
    }
  });

  const setClause = Object.keys(processedData).map(key => `${key} = ?`).join(', ');
  const values = [...Object.values(processedData), ampId];

  const query = `UPDATE ai_model_providers SET ${setClause} WHERE amp_id = ?`;
  return await mysqlQueryRunner.runQueryInMaster(query, values);
};

// --- Categories ---

exports.listCategories = async function () {
  const query = `SELECT * FROM ai_model_categories ORDER BY sort_order ASC, name ASC`;
  return await mysqlQueryRunner.runQueryInSlave(query, []);
};

exports.getCategoriesByIds = async function (ids) {
  if (!ids || ids.length === 0) return [];
  const query = `SELECT * FROM ai_model_categories WHERE amc_id IN (?)`;
  return await mysqlQueryRunner.runQueryInSlave(query, [ids]);
};


// --- Socket Types ---

exports.listSocketTypes = async function () {
  const query = `SELECT * FROM ai_model_socket_types ORDER BY name ASC`;
  return await mysqlQueryRunner.runQueryInSlave(query, []);
};

exports.getSocketTypesByIds = async function (ids) {
  if (!ids || ids.length === 0) return [];
  const query = `SELECT * FROM ai_model_socket_types WHERE amst_id IN (?)`;
  return await mysqlQueryRunner.runQueryInSlave(query, [ids]);
};

// --- Tags (ai_model_registry_tags + ai_model_tag_definitions) ---

exports.getTagsForAmrId = async function (amrId) {
  const junctionQuery = `SELECT amtd_id FROM ai_model_registry_tags WHERE amr_id = ? ORDER BY amtd_id ASC`;
  const rows = await mysqlQueryRunner.runQueryInSlave(junctionQuery, [amrId]);
  if (!rows || rows.length === 0) return [];
  const amtdIds = rows.map(r => r.amtd_id);
  const placeholders = amtdIds.map(() => '?').join(', ');
  const defQuery = `
    SELECT amtd_id, tag_name, tag_code, tag_description
    FROM ai_model_tag_definitions
    WHERE amtd_id IN (${placeholders}) AND deleted_at IS NULL
  `;
  const definitions = await mysqlQueryRunner.runQueryInSlave(defQuery, amtdIds);
  return definitions;
};

exports.setTagsForAmrId = async function (amrId, amtdIds) {
  const deleteQuery = `DELETE FROM ai_model_registry_tags WHERE amr_id = ?`;
  await mysqlQueryRunner.runQueryInMaster(deleteQuery, [amrId]);
  if (!amtdIds || amtdIds.length === 0) return;
  const values = amtdIds.map(id => `(?, ?)`).join(', ');
  const insertQuery = `INSERT INTO ai_model_registry_tags (amr_id, amtd_id) VALUES ${values}`;
  const params = amtdIds.flatMap(id => [amrId, id]);
  await mysqlQueryRunner.runQueryInMaster(insertQuery, params);
};

// --- IO Definitions ---

exports.getIoDefinitionsByModelId = async function (amrId) {
  const query = `
    SELECT * FROM ai_model_io_definitions
    WHERE amr_id = ?
    ORDER BY sort_order ASC
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, [amrId]);
};

exports.createIoDefinition = async function (data) {
  const processedData = {
    ...data,
    default_value: data.default_value ? JSON.stringify(data.default_value) : null,
    constraints: data.constraints ? JSON.stringify(data.constraints) : '{}'
  };

  const columns = Object.keys(processedData);
  const placeholders = columns.map(() => '?').join(', ');
  const values = Object.values(processedData);

  const query = `INSERT INTO ai_model_io_definitions (${columns.join(', ')}) VALUES (${placeholders})`;
  return await mysqlQueryRunner.runQueryInMaster(query, values);
};

exports.updateIoDefinition = async function (amiodId, data) {
  const processedData = {};
  Object.keys(data).forEach(key => {
    if (['default_value', 'constraints'].includes(key)) {
      processedData[key] = typeof data[key] === 'object' ? JSON.stringify(data[key]) : data[key];
    } else {
      processedData[key] = data[key];
    }
  });

  const setClause = Object.keys(processedData).map(key => `${key} = ?`).join(', ');
  const values = [...Object.values(processedData), amiodId];

  const query = `UPDATE ai_model_io_definitions SET ${setClause} WHERE amiod_id = ?`;
  return await mysqlQueryRunner.runQueryInMaster(query, values);
};

exports.deleteIoDefinition = async function (amiodId) {
  const query = `DELETE FROM ai_model_io_definitions WHERE amiod_id = ?`;
  return await mysqlQueryRunner.runQueryInMaster(query, [amiodId]);
};

/**
 * Get mapping metadata for a model (inputs, parameters, outputs) for fallback mapping UI.
 * Returns only names/labels needed to build mapping dropdowns.
 */
exports.getMappingMetadataByAmrId = async function (amrId) {
  const model = await mysqlQueryRunner.runQueryInSlave(
    'SELECT parameter_schema FROM ai_model_registry WHERE amr_id = ? AND archived_at IS NULL',
    [amrId]
  );
  if (!model || model.length === 0) return null;

  const ioDefs = await mysqlQueryRunner.runQueryInSlave(
    `SELECT name, label, direction, sort_order FROM ai_model_io_definitions WHERE amr_id = ? ORDER BY sort_order ASC`,
    [amrId]
  );

  const inputs = ioDefs
    .filter(io => io.direction === 'INPUT')
    .map(io => ({ name: io.name, label: io.label || io.name }));
  const outputs = ioDefs
    .filter(io => io.direction === 'OUTPUT')
    .map(io => ({ name: io.name, label: io.label || io.name }));

  let parameterSchema = model[0].parameter_schema;
  if (typeof parameterSchema === 'string') {
    try { parameterSchema = JSON.parse(parameterSchema); } catch (e) { parameterSchema = {}; }
  }
  const parameters = (parameterSchema.properties && Object.keys(parameterSchema.properties)) || [];
  const parametersList = parameters.map(name => ({ name }));

  return { inputs, parameters: parametersList, outputs };
};

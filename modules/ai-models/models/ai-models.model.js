'use strict';

const mysqlPromiseModel = require('../../core/models/mysql.promise.model');

/**
 * Get all AI models with platform information
 */
exports.getAllModels = async () => {
  const query = `
    SELECT 
      am.*,
      p.name as platform_name,
      p.description as platform_description
    FROM ai_models am
    LEFT JOIN platforms p ON am.platform_id = p.platform_id
    WHERE am.is_active = 1 AND am.is_archived = 0
    ORDER BY am.name ASC
  `;
  
  return mysqlPromiseModel.runQueryInSlave(query);
};

/**
 * Get all AI models including archived ones
 */
exports.getAllModelsWithArchived = async () => {
  const query = `
    SELECT 
      am.*,
      p.name as platform_name,
      p.description as platform_description
    FROM ai_models am
    LEFT JOIN platforms p ON am.platform_id = p.platform_id
    WHERE am.is_active = 1
    ORDER BY am.name ASC
  `;
  
  return mysqlPromiseModel.runQueryInSlave(query);
};

/**
 * Get a single AI model by ID with platform information
 */
exports.getModelById = async (modelId) => {
  const query = `
    SELECT 
      am.*,
      p.name as platform_name,
      p.description as platform_description
    FROM ai_models am
    LEFT JOIN platforms p ON am.platform_id = p.platform_id
    WHERE am.model_id = ?
  `;
  
  const results = await mysqlPromiseModel.runQueryInSlave(query, [modelId]);
  return results.length ? results[0] : null;
};

/**
 * Get a single AI model by slug with platform information
 */
exports.getModelBySlug = async (slug) => {
  const query = `
    SELECT 
      am.*,
      p.name as platform_name,
      p.description as platform_description
    FROM ai_models am
    LEFT JOIN platforms p ON am.platform_id = p.platform_id
    WHERE am.slug = ?
  `;
  
  const results = await mysqlPromiseModel.runQueryInSlave(query, [slug]);
  return results.length ? results[0] : null;
};

/**
 * Get AI models by platform ID
 */
exports.getModelsByPlatformId = async (platformId) => {
  const query = `
    SELECT 
      am.*,
      p.name as platform_name,
      p.description as platform_description
    FROM ai_models am
    LEFT JOIN platforms p ON am.platform_id = p.platform_id
    WHERE am.platform_id = ? AND am.is_active = 1 AND am.is_archived = 0
    ORDER BY am.name ASC
  `;
  
  return mysqlPromiseModel.runQueryInSlave(query, [platformId]);
};

/**
 * Check if platform_model_id exists for a platform
 */
exports.checkPlatformModelIdExists = async (platformId, platformModelId, excludeModelId = null) => {
  let query = `
    SELECT model_id FROM ai_models
    WHERE platform_id = ? AND platform_model_id = ?
  `;
  const params = [platformId, platformModelId];
  
  if (excludeModelId) {
    query += ' AND model_id != ?';
    params.push(excludeModelId);
  }
  
  const results = await mysqlPromiseModel.runQueryInSlave(query, params);
  return results.length > 0;
};

/**
 * Create a new AI model
 */
exports.createModel = async (modelData) => {
  const query = `
    INSERT INTO ai_models 
    (model_id, platform_id, name, slug, description, platform_model_id, min_generation, max_generation, parameters, inputs, is_active, is_archived)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  const params = [
    modelData.model_id,
    modelData.platform_id,
    modelData.name,
    modelData.slug,
    modelData.description,
    modelData.platform_model_id,
    modelData.min_generation || 0,
    modelData.max_generation || null,
    JSON.stringify(modelData.parameters || {}),
    JSON.stringify(modelData.inputs || []),
    modelData.is_active !== undefined ? modelData.is_active : 1,
    modelData.is_archived !== undefined ? modelData.is_archived : 0
  ];
  
  return mysqlPromiseModel.runQueryInMaster(query, params);
};

/**
 * Update an AI model
 */
exports.updateModel = async (modelId, modelData) => {
  const updateFields = [];
  const params = [];
  
  if (modelData.platform_id !== undefined) {
    updateFields.push('platform_id = ?');
    params.push(modelData.platform_id);
  }
  
  if (modelData.name !== undefined) {
    updateFields.push('name = ?');
    params.push(modelData.name);
  }
  
  if (modelData.slug !== undefined) {
    updateFields.push('slug = ?');
    params.push(modelData.slug);
  }
  
  if (modelData.description !== undefined) {
    updateFields.push('description = ?');
    params.push(modelData.description);
  }
  
  if (modelData.platform_model_id !== undefined) {
    updateFields.push('platform_model_id = ?');
    params.push(modelData.platform_model_id);
  }
  
  if (modelData.min_generation !== undefined) {
    updateFields.push('min_generation = ?');
    params.push(modelData.min_generation);
  }
  
  if (modelData.max_generation !== undefined) {
    updateFields.push('max_generation = ?');
    params.push(modelData.max_generation);
  }
  
  if (modelData.parameters !== undefined) {
    updateFields.push('parameters = ?');
    params.push(JSON.stringify(modelData.parameters));
  }
  
  if (modelData.inputs !== undefined) {
    updateFields.push('inputs = ?');
    params.push(JSON.stringify(modelData.inputs));
  }
  
  if (modelData.is_active !== undefined) {
    updateFields.push('is_active = ?');
    params.push(modelData.is_active);
  }
  
  if (modelData.is_archived !== undefined) {
    updateFields.push('is_archived = ?');
    params.push(modelData.is_archived);
  }
  
  if (updateFields.length === 0) {
    return { affectedRows: 0 };
  }
  
  params.push(modelId);
  
  const query = `
    UPDATE ai_models
    SET ${updateFields.join(', ')}
    WHERE model_id = ?
  `;
  
  return mysqlPromiseModel.runQueryInMaster(query, params);
};

/**
 * Archive an AI model (soft delete)
 */
exports.archiveModel = async (modelId) => {
  const query = `
    UPDATE ai_models
    SET is_archived = 1
    WHERE model_id = ?
  `;
  
  return mysqlPromiseModel.runQueryInMaster(query, [modelId]);
};

/**
 * Unarchive an AI model
 */
exports.unarchiveModel = async (modelId) => {
  const query = `
    UPDATE ai_models
    SET is_archived = 0
    WHERE model_id = ?
  `;
  
  return mysqlPromiseModel.runQueryInMaster(query, [modelId]);
};

/**
 * Delete an AI model (hard delete)
 */
exports.deleteModel = async (modelId) => {
  const query = `
    DELETE FROM ai_models
    WHERE model_id = ?
  `;
  
  return mysqlPromiseModel.runQueryInMaster(query, [modelId]);
}; 
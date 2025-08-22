'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.listAllAiModels = async function(searchParams = {}, paginationParams = null) {
  let query = `
    SELECT 
      model_id,
      amp_platform_id,
      model_name,
      description,
      platform_model_id,
      input_types,
      output_types,
      supported_video_qualities,
      costs,
      generation_time_ms,
      status,
      created_at,
      updated_at
    FROM ai_models
    WHERE archived_at IS NULL
  `;

  const queryParams = [];
  const conditions = [];

  // Filter by input types
  if (searchParams.input_types && searchParams.input_types.length > 0) {
    const inputTypeConditions = searchParams.input_types.map(() => `JSON_CONTAINS(input_types, ?)`);
    conditions.push(`(${inputTypeConditions.join(' OR ')})`);
    searchParams.input_types.forEach(type => {
      queryParams.push(JSON.stringify(type));
    });
  }

  // Filter by output types
  if (searchParams.output_types && searchParams.output_types.length > 0) {
    const outputTypeConditions = searchParams.output_types.map(() => `JSON_CONTAINS(output_types, ?)`);
    conditions.push(`(${outputTypeConditions.join(' OR ')})`);
    searchParams.output_types.forEach(type => {
      queryParams.push(JSON.stringify(type));
    });
  }

  // Add conditions to query
  if (conditions.length > 0) {
    query += ` AND ${conditions.join(' AND ')}`;
  }

  // Add pagination if provided
  if (paginationParams) {
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    queryParams.push(paginationParams.limit, paginationParams.offset);
  } else {
    query += ` ORDER BY created_at DESC`;
  }

  const models = await mysqlQueryRunner.runQueryInSlave(query, queryParams);
  
  return {
    models
  };
};

exports.getPlatformsByIds = async function(platformIds) {
  if (!platformIds || platformIds.length === 0) {
    return [];
  }

  const query = `
    SELECT 
      amp_platform_id,
      platform_name,
      platform_code,
      description,
      platform_logo_key,
      platform_logo_bucket,
      created_at,
      updated_at
    FROM ai_model_provider_platforms
    WHERE amp_platform_id IN (?)
    ORDER BY platform_name ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [platformIds]);
};

exports.getAiModelById = async function(modelId) {
  const query = `
    SELECT 
      model_id,
      amp_platform_id,
      model_name,
      description,
      platform_model_id,
      input_types,
      output_types,
      costs,
      generation_time_ms,
      status,
      created_at,
      updated_at
    FROM ai_models
    WHERE model_id = ?
    AND archived_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [modelId]);
};

/**
 * Get multiple AI models by their IDs
 */
exports.getAiModelsByIds = async function(modelIds) {
  if (!Array.isArray(modelIds) || modelIds.length === 0) {
    return [];
  }

  const placeholders = modelIds.map(() => '?').join(',');
  const query = `
    SELECT 
      model_id,
      amp_platform_id,
      model_name,
      description,
      platform_model_id,
      input_types,
      output_types,
      costs,
      generation_time_ms,
      status,
      created_at,
      updated_at
    FROM ai_models
    WHERE model_id IN (${placeholders})
    AND archived_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, modelIds);
};

exports.getPlatformById = async function(platformId) {
  const query = `
    SELECT 
      amp_platform_id,
      platform_name,
      platform_code,
      description,
      platform_logo_key,
      platform_logo_bucket,
      created_at,
      updated_at
    FROM ai_model_provider_platforms
    WHERE amp_platform_id = ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [platformId]);
};

exports.createAiModel = async function(modelData) {
  // Convert arrays and objects to JSON strings for MySQL storage
  const processedData = {
    ...modelData,
    input_types: modelData.input_types ? JSON.stringify(modelData.input_types) : null,
    output_types: modelData.output_types ? JSON.stringify(modelData.output_types) : null,
    supported_video_qualities: modelData.supported_video_qualities ? JSON.stringify(modelData.supported_video_qualities) : null,
    costs: modelData.costs ? JSON.stringify(modelData.costs) : null
  };

  const columns = Object.keys(processedData);
  const placeholders = columns.map(() => '?').join(', ');
  const values = Object.values(processedData).map(val => val || null);

  const query = `
    INSERT INTO ai_models (${columns.join(', ')}) 
    VALUES (${placeholders})
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, values);
};

exports.updateAiModel = async function(modelId, updateData) {
  // Convert arrays and objects to JSON strings for MySQL storage
  const processedData = {};
  Object.keys(updateData).forEach(key => {
    if (['input_types', 'output_types', 'supported_video_qualities', 'costs'].includes(key)) {
      processedData[key] = updateData[key] ? JSON.stringify(updateData[key]) : null;
    } else {
      processedData[key] = updateData[key];
    }
  });

  const setClause = Object.entries(processedData)
    .map(([key]) => `${key} = ?`)
    .join(', ');
  
  const values = [...Object.values(processedData), modelId];

  const query = `
    UPDATE ai_models 
    SET ${setClause}
    WHERE model_id = ?
    AND archived_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, values);
};

exports.checkModelExists = async function(modelId) {
  const query = `
    SELECT model_id 
    FROM ai_models 
    WHERE model_id = ? 
    AND archived_at IS NULL
  `;
  
  const [model] = await mysqlQueryRunner.runQueryInSlave(query, [modelId]);
  return !!model;
};

exports.checkModelIdExists = async function(modelId) {
  const query = `
    SELECT model_id 
    FROM ai_models 
    WHERE model_id = ?
  `;
  
  const [model] = await mysqlQueryRunner.runQueryInSlave(query, [modelId]);
  return !!model;
};

exports.checkPlatformExists = async function(platformId) {
  const query = `
    SELECT amp_platform_id 
    FROM ai_model_provider_platforms 
    WHERE amp_platform_id = ?
  `;
  
  const [platform] = await mysqlQueryRunner.runQueryInSlave(query, [platformId]);
  return !!platform;
};

exports.createPlatform = async function(platformData) {
  const columns = Object.keys(platformData);
  const placeholders = columns.map(() => '?').join(', ');
  const values = Object.values(platformData).map(val => val || null);

  const query = `
    INSERT INTO ai_model_provider_platforms (${columns.join(', ')}) 
    VALUES (${placeholders})
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, values);
};

exports.listAllPlatforms = async function(paginationParams = null) {
  let query = `
    SELECT 
      amp_platform_id,
      platform_name,
      platform_code,
      description,
      platform_logo_key,
      platform_logo_bucket,
      created_at,
      updated_at
    FROM ai_model_provider_platforms
  `;

  // Add pagination if provided
  if (paginationParams) {
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const queryParams = [paginationParams.limit, paginationParams.offset];
    const platforms = await mysqlQueryRunner.runQueryInSlave(query, queryParams);
    
    return {
      platforms
    };
  } else {
    query += ` ORDER BY created_at DESC`;
    const platforms = await mysqlQueryRunner.runQueryInSlave(query, []);
    
    return {
      platforms
    };
  }
};

exports.updatePlatform = async function(platformId, updateData) {
  const setClause = Object.entries(updateData)
    .map(([key]) => `${key} = ?`)
    .join(', ');

  const values = [...Object.values(updateData), platformId];

  const query = `
    UPDATE ai_model_provider_platforms 
    SET ${setClause}
    WHERE amp_platform_id = ?
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, values);
};

// Tag management methods
exports.getAiModelTags = async function(modelId) {
  const query = `
    SELECT 
      amtd_id
    FROM ai_model_tags
    WHERE ai_model_id = ?
    AND deleted_at IS NULL
    ORDER BY amtd_id ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [modelId]);
};

exports.createAiModelTag = async function(modelId, tagDefinitionId) {
  const query = `
    INSERT INTO ai_model_tags (
      amtd_id,
      ai_model_id
    ) VALUES (?, ?)
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, [tagDefinitionId, modelId]);
};

exports.deleteAiModelTag = async function(modelId, tagDefinitionId) {
  const query = `
    UPDATE ai_model_tags 
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE ai_model_id = ?
    AND amtd_id = ?
    AND deleted_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, [modelId, tagDefinitionId]);
};

exports.deleteAllAiModelTags = async function(modelId) {
  const query = `
    UPDATE ai_model_tags 
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE ai_model_id = ?
    AND deleted_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInMaster(query, [modelId]);
};

exports.updateAiModelTags = async function(modelId, tagIds) {
  // Get current tags for this model
  const currentTags = await this.getAiModelTags(modelId);
  const currentTagIds = currentTags.map(tag => tag.amtd_id);
  
  // Convert tagIds to numbers for comparison
  const newTagIds = tagIds.map(id => parseInt(id));
  
  // Find tags to add (new tags that don't exist)
  const tagsToAdd = newTagIds.filter(tagId => !currentTagIds.includes(tagId));
  
  // Find tags to remove (existing tags that are not in new list)
  const tagsToRemove = currentTagIds.filter(tagId => !newTagIds.includes(tagId));
  
  // Add new tags
  for (const tagId of tagsToAdd) {
    await this.createAiModelTag(modelId, tagId);
  }
  
  // Remove old tags
  for (const tagId of tagsToRemove) {
    await this.deleteAiModelTag(modelId, tagId);
  }
  
  return {
    added: tagsToAdd,
    removed: tagsToRemove
  };
}; 
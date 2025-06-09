'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.listAllAiModels = async function(searchParams = {}) {
  let query = `
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
    WHERE status = 'active'
    AND archived_at IS NULL
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

  query += ` ORDER BY created_at DESC`;

  return await mysqlQueryRunner.runQueryInSlave(query, queryParams);
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
    AND status = 'active'
    AND archived_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [modelId]);
};

exports.getPlatformById = async function(platformId) {
  const query = `
    SELECT 
      amp_platform_id,
      platform_name,
      platform_code,
      description,
      created_at,
      updated_at
    FROM ai_model_provider_platforms
    WHERE amp_platform_id = ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [platformId]);
}; 
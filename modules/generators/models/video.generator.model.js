'use strict';

const {
  runQueryInMaster: RunCHQueryInMaster,
  runQueryingInSlave: RunCHQueryingInSlave
} = require('../../core/models/clickhouse.promise.model');
const logger = require('../../../config/lib/logger');

exports.insertResourceGeneration = async function(generationData) {
  const columns = Object.keys(generationData[0]).join(', ');
  const values = generationData.map(data =>
    Object.values(data).map(value =>
      typeof value === 'string' ? `'${value}'` : `'${value}'`
    ).join(', ')
  ).join('), (');

  const query = `
    INSERT INTO resource_generations
    (${columns})
    VALUES
    (${values})
  `;

  try {
    await RunCHQueryInMaster(query);
  } catch (error) {
    logger.error('Error inserting resource generation:', { error: error.message, stack: error.stack });
    throw error;
  }
};

exports.insertResourceGenerationEvent = async function(eventData) {
  const columns = Object.keys(eventData[0]).join(', ');
  const values = eventData.map(data =>
    Object.values(data).map(value => {
      if (typeof value === 'object') {
        return `'${JSON.stringify(value).replace(/'/g, "\\'")}'`;
      }
      return `'${String(value).replace(/'/g, "\\'")}'`;
    }).join(', ')
  ).join('), (');

  const query = `
    INSERT INTO resource_generation_events
    (${columns})
    VALUES
    (${values})
  `;

  try {
    await RunCHQueryInMaster(query);
  } catch (error) {
    logger.error('Error inserting resource generation event:', { error: error.message, stack: error.stack });
    throw error;
  }
};

exports.getResourceGenerations = async function(userId, page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  
  const query = `
    SELECT 
      resource_generation_id,
      user_character_ids,
      template_id,
      type,
      media_type,
      additional_data,
      created_at
    FROM resource_generations
    WHERE user_id = '${userId}'
    AND media_type = 'video'
    ORDER BY created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  try {
    return await RunCHQueryingInSlave(query);
  } catch (error) {
    logger.error('Error fetching resource generations:', { error: error.message, stack: error.stack });
    throw error;
  }
};

exports.verifyGenerationOwnership = async function(generationId, userId) {
  const query = `
    SELECT user_id
    FROM resource_generations
    WHERE resource_generation_id = '${generationId}'
    AND user_id = '${userId}'
    LIMIT 1
  `;

  try {
    const result = await RunCHQueryingInSlave(query);
    return result && result.length > 0;
  } catch (error) {
    logger.error('Error verifying generation ownership:', { error: error.message, stack: error.stack });
    throw error;
  }
};

exports.getLatestGenerationEvent = async function(generationId) {
  const query = `
    SELECT 
      resource_generation_id,
      event_type,
      additional_data,
      created_at
    FROM resource_generation_events
    WHERE resource_generation_id = '${generationId}'
    ORDER BY created_at DESC
    LIMIT 1
  `;

  try {
    const result = await RunCHQueryingInSlave(query);
    return result[0] || null;
  } catch (error) {
    logger.error('Error fetching latest generation event:', { error: error.message, stack: error.stack });
    throw error;
  }
};

exports.getAllGenerationEvents = async function(generationId) {
  const query = `
    SELECT 
      resource_generation_event_id,
      resource_generation_id,
      event_type,
      additional_data,
      created_at
    FROM resource_generation_events
    WHERE resource_generation_id = '${generationId}'
    ORDER BY created_at ASC
  `;

  try {
    const result = await RunCHQueryingInSlave(query);
    return result || [];
  } catch (error) {
    logger.error('Error fetching all generation events:', { error: error.message, stack: error.stack });
    throw error;
  }
}; 
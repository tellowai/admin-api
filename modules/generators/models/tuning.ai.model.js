'use strict';

const {
  runQueryInMaster: RunCHQueryInMaster,
  runQueryingInSlave: RunCHQueryingInSlave
} = require('../../core/models/clickhouse.promise.model');
const logger = require('../../../config/lib/logger');

exports.getLatestTuningSession = async function(userCharacterId) {
  const query = `
    SELECT 
      tuning_session_id,
      user_character_id, 
      user_id,
      type,
      media_type,
      created_at
    FROM tuning_sessions
    WHERE user_character_id = '${userCharacterId}'
    ORDER BY created_at DESC 
    LIMIT 1
  `;

  try {
    const result = await RunCHQueryingInSlave(query);
    return result[0] || null;
  } catch (error) {
    logger.error('Error fetching tuning session:', { error: error.message, stack: error.stack });
    throw error;
  }
};

exports.insertTuningSession = async function(tuningData) {
  const columns = Object.keys(tuningData[0]).join(', ');
  const values = tuningData.map(data =>
    Object.values(data).map(value =>
      typeof value === 'string' ? `'${value}'` : `'${value}'`
    ).join(', ')
  ).join('), (');

  const query = `
    INSERT INTO tuning_sessions
    (${columns})
    VALUES
    (${values})
  `;

  try {
    await RunCHQueryInMaster(query);
  } catch (error) {
    logger.error('Error inserting tuning session:', { error: error.message, stack: error.stack });
    throw error;
  }
};

exports.updateTuningSession = async function(tuningSessionId, updateData) {
  const columns = Object.entries(updateData)
    .map(([key, value]) => `${key} = '${value}'`)
    .join(', ');

  const query = `
    ALTER TABLE tuning_sessions
    UPDATE ${columns}
    WHERE tuning_session_id = '${tuningSessionId}'
  `;

  try {
    await RunCHQueryInMaster(query);
  } catch (error) {
    logger.error('Error updating tuning session:', { error: error.message, stack: error.stack });
    throw error;
  }
};

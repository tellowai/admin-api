'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { slaveClickhouse } = require('../../../config/lib/clickhouse');
const moment = require('moment'); // Using moment as it's typically used in this project codebase based on API's media.generations.model.js

/**
 * Convert ISO or Date to MySQL datetime string (YYYY-MM-DD HH:mm:ss).
 * @param {Date|string|null} date
 * @returns {string|null}
 */
function formatDateForMySQL(date) {
  if (!date) return null;
  const m = moment(date);
  return m.isValid() ? m.format('YYYY-MM-DD HH:mm:ss') : null;
}

/**
 * Fetch generations with date filtering and pagination
 * @param {Date|string} startDate 
 * @param {Date|string} endDate 
 * @param {number} page 
 * @param {number} limit 
 * @returns {Promise<Array>}
 */
exports.getGenerationsByDateRange = async function (startDate, endDate, page = 1, limit = 20) {
  const offset = (page - 1) * limit;

  const startFormatted = formatDateForMySQL(startDate);
  let endFormatted = formatDateForMySQL(endDate);

  if(!endFormatted) {
    // defaults to end of today if not valid
    endFormatted = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss');
  }

  const query = `
    SELECT 
      resource_generation_id AS media_generation_id,
      if(event_type = 'COMPLETED', 'completed', 'failed') AS job_status,
      JSONExtractString(additional_data, 'output', 'asset_bucket') AS output_media_bucket,
      JSONExtractString(additional_data, 'output', 'asset_key') AS output_media_asset_key,
      created_at AS completed_at,
      if(event_type = 'FAILED', JSONExtractString(additional_data, 'error', 'message'), '') AS error_message
    FROM resource_generation_events
    WHERE event_type IN ('COMPLETED', 'FAILED')
      AND created_at >= '${startFormatted}' AND created_at <= '${endFormatted}'
    ORDER BY created_at DESC, resource_generation_id ASC
    LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
  `;

  const result = await slaveClickhouse.querying(query, { dataObjects: true });
  return result.data || [];
};

/**
 * Fetch total count of generations within that date range for pagination calculation
 * @param {Date|string} startDate 
 * @param {Date|string} endDate 
 * @returns {Promise<number>}
 */
exports.getGenerationsCountByDateRange = async function (startDate, endDate) {
  const startFormatted = formatDateForMySQL(startDate);
  let endFormatted = formatDateForMySQL(endDate);

  if(!endFormatted) {
    // defaults to end of today if not valid
    endFormatted = moment().endOf('day').format('YYYY-MM-DD HH:mm:ss');
  }

  const query = `
    SELECT COUNT(*) as total
    FROM resource_generation_events
    WHERE event_type IN ('COMPLETED', 'FAILED')
      AND created_at >= '${startFormatted}' AND created_at <= '${endFormatted}'
  `;

  const result = await slaveClickhouse.querying(query, { dataObjects: true });
  return result.data?.[0]?.total || 0;
};

/**
 * Fetch bulk resource generations by IDs from ClickHouse
 * @param {Array<string>} generationIds
 * @returns {Promise<Array>}
 */
exports.getResourceGenerationsByIds = async function (generationIds) {
  if (!generationIds || generationIds.length === 0) return [];
  
  // Format the IDs for ClickHouse IN clause (strings wrapped in single quotes)
  const formattedIds = generationIds.map(id => `'${id}'`).join(',');
  
  const query = `
    SELECT 
      resource_generation_id,
      user_id,
      template_id,
      media_type,
      created_at
    FROM resource_generations
    WHERE resource_generation_id IN (${formattedIds})
  `;
  const result = await slaveClickhouse.querying(query, { dataObjects: true });
  return result.data || [];
};

/**
 * Fetch bulk users by IDs
 * @param {Array<string>} userIds
 * @returns {Promise<Array>}
 */
exports.getUsersByIds = async function (userIds) {
  if (!userIds || userIds.length === 0) return [];
  const query = `
    SELECT user_id, display_name, email, mobile, profile_pic, profile_pic_asset_key, profile_pic_bucket
    FROM user
    WHERE user_id IN (?)
  `;
  // runQueryInSlave to offload reading if master isn't strictly needed
  return await mysqlQueryRunner.runQueryInSlave(query, [userIds]);
};

/**
 * Fetch bulk templates by IDs
 * @param {Array<string>} templateIds
 * @returns {Promise<Array>}
 */
exports.getTemplatesByIds = async function (templateIds) {
  if (!templateIds || templateIds.length === 0) return [];
  const query = `
    SELECT template_id, template_name
    FROM templates
    WHERE template_id IN (?)
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, [templateIds]);
};


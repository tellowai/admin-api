'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
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
      media_generation_id,
      user_id,
      template_id,
      media_type,
      output_format,
      job_status,
      output_media_bucket,
      output_media_asset_key,
      created_at,
      completed_at,
      error_message
    FROM media_generations
    WHERE created_at >= ? AND created_at <= ?
    AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  const params = [startFormatted, endFormatted, parseInt(limit), parseInt(offset)];
  return await mysqlQueryRunner.runQueryInSlave(query, params);
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
    FROM media_generations
    WHERE created_at >= ? AND created_at <= ?
    AND deleted_at IS NULL
  `;

  const params = [startFormatted, endFormatted];
  const [result] = await mysqlQueryRunner.runQueryInSlave(query, params);
  
  return result && result.total ? result.total : 0;
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


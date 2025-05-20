'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * List admin media with pagination
 * @param {Object} params Pagination parameters
 * @returns {Promise<Array>} Media data
 */
exports.listAdminMedia = async function(params) {
  const { limit, offset } = params;

  const mediaQuery = `
    SELECT 
      media_id,
      user_character_id,
      user_id,
      created_by_admin_id,
      cf_r2_key,
      cf_r2_bucket,
      cf_r2_url,
      tag,
      media_type,
      is_auto_generated,
      additional_data,
      created_at
    FROM media_files
    WHERE user_id IS NULL 
    AND created_by_admin_id IS NOT NULL
    AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(mediaQuery, [limit, offset]);
}; 
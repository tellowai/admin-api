'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * List app ratings in a created_at range with pagination.
 * @param {Object} opts
 * @param {Date} opts.startDate
 * @param {Date} opts.endDate
 * @param {number} opts.limit
 * @param {number} opts.offset
 * @param {string} [opts.platform]
 * @returns {Promise<{ rows: Array, total: number }>}
 */
exports.listRatingsByDateRange = async function ({
  startDate,
  endDate,
  limit,
  offset,
  platform
}) {
  const conditions = ['created_at >= ?', 'created_at <= ?'];
  const params = [startDate, endDate];

  if (platform) {
    conditions.push('platform = ?');
    params.push(platform);
  }

  const whereClause = conditions.join(' AND ');

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM app_ratings
    WHERE ${whereClause}
  `;
  const countResult = await mysqlQueryRunner.runQueryInSlave(countQuery, params);
  const total = countResult[0]?.total ?? 0;

  const listQuery = `
    SELECT
      rating_id,
      user_id,
      app_version,
      rating,
      reason,
      platform,
      created_at
    FROM app_ratings
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  const rows = await mysqlQueryRunner.runQueryInSlave(listQuery, [
    ...params,
    limit,
    offset
  ]);

  return { rows, total: Number(total) };
};

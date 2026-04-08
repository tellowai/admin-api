'use strict';

const MysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * Sum of template_slots_remaining across all entitlement rows for a user.
 * @param {string} userId
 * @returns {Promise<number>}
 */
exports.sumTemplateSlotsRemainingByUserId = async function (userId) {
  const query = `
    SELECT COALESCE(SUM(template_slots_remaining), 0) AS total
    FROM entitlements
    WHERE user_id = ?
  `;
  const rows = await MysqlQueryRunner.runQueryInSlave(query, [userId]);
  const n = rows && rows[0] ? Number(rows[0].total) : 0;
  return Number.isFinite(n) ? n : 0;
};

/**
 * Paginated entitlements for a user (newest first).
 * @param {string} userId
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<Array>}
 */
exports.listByUserId = async function (userId, limit, offset) {
  const query = `
    SELECT
      entitlement_id,
      user_id,
      order_id,
      template_id,
      tier_plan_type,
      template_slots_remaining,
      max_creations_per_template,
      status,
      is_expired,
      valid_from,
      valid_until,
      created_at,
      updated_at
    FROM entitlements
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  return await MysqlQueryRunner.runQueryInSlave(query, [userId, limit, offset]);
};

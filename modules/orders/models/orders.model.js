'use strict';

const MysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * Get orders for a user. Simple single-table query; no joins.
 * @param {string} userId
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<Array>}
 */
exports.getByUserId = async function (userId, limit, offset) {
  const query = `
    SELECT order_id, user_id, payment_gateway, pg_order_id, quantity, pg_payment_id,
           payment_plan_id, amount_paid, currency, payment_method, status,
           created_at, completed_at, failed_at, refunded_at
    FROM orders
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  return await MysqlQueryRunner.runQueryInSlave(query, [userId, limit, offset]);
};

'use strict';

const MysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * @param {{ status?: string, productType?: string, search?: string }} filters
 * @returns {{ whereSql: string, params: any[] }}
 */
function buildAdminOrdersWhere(filters) {
  const where = ['1=1'];
  const params = [];
  const status = filters.status && String(filters.status).trim();
  const productType = filters.productType && String(filters.productType).trim();
  const search = filters.search && String(filters.search).trim();

  if (status && ['created', 'completed', 'failed'].includes(status)) {
    where.push('o.status = ?');
    params.push(status);
  }

  if (productType === 'alacarte') {
    where.push('p.plan_type = ?');
    params.push('single');
  } else if (productType === 'addon') {
    where.push('p.plan_type = ?');
    params.push('addon');
  } else if (productType === 'subscription') {
    where.push('p.plan_type IN (?, ?)');
    params.push('bundle', 'credits');
  }

  if (search) {
    const term = `%${search}%`;
    where.push('(o.user_id LIKE ? OR CAST(o.order_id AS CHAR) LIKE ?)');
    params.push(term, term);
  }

  return { whereSql: where.join(' AND '), params };
}

const ORDERS_ADMIN_SELECT = `
  SELECT
    o.order_id,
    o.user_id,
    o.payment_gateway,
    o.pg_order_id,
    o.quantity,
    o.pg_payment_id,
    o.payment_plan_id,
    o.amount_paid,
    o.currency,
    o.payment_method,
    o.status,
    o.created_at,
    o.completed_at,
    o.failed_at,
    o.refunded_at,
    p.plan_type AS plan_type,
    p.plan_name AS plan_name,
    p.plan_heading AS plan_heading,
    p.billing_interval AS billing_interval
  FROM orders o
  LEFT JOIN payment_plans p ON o.payment_plan_id = p.pp_id
`;

/**
 * Admin list: orders with plan metadata; filters by status, product bucket, search (user id or order id).
 * @param {{ limit: number, offset: number, status?: string, productType?: string, search?: string }} filters
 * @returns {Promise<Array>}
 */
exports.listOrdersAdmin = async function (filters) {
  const { limit, offset } = filters;
  const { whereSql, params } = buildAdminOrdersWhere(filters);
  const query = `
    ${ORDERS_ADMIN_SELECT}
    WHERE ${whereSql}
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `;
  return await MysqlQueryRunner.runQueryInSlave(query, [...params, limit, offset]);
};

/**
 * @param {{ status?: string, productType?: string, search?: string }} filters
 * @returns {Promise<number>}
 */
exports.countOrdersAdmin = async function (filters) {
  const { whereSql, params } = buildAdminOrdersWhere(filters);
  const query = `
    SELECT COUNT(*) AS total
    FROM orders o
    LEFT JOIN payment_plans p ON o.payment_plan_id = p.pp_id
    WHERE ${whereSql}
  `;
  const rows = await MysqlQueryRunner.runQueryInSlave(query, params);
  const n = rows && rows[0] ? Number(rows[0].total) : 0;
  return Number.isFinite(n) ? n : 0;
};

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

/**
 * Batch fetch orders by internal order_id (for stitching entitlement rows).
 * @param {number[]} orderIds
 * @returns {Promise<Array>}
 */
exports.getByOrderIds = async function (orderIds) {
  if (!orderIds || orderIds.length === 0) return [];
  const placeholders = orderIds.map(() => '?').join(',');
  const query = `
    SELECT order_id, user_id, payment_gateway, pg_order_id, payment_plan_id,
           amount_paid, currency, payment_method, status,
           created_at, completed_at, failed_at, refunded_at
    FROM orders
    WHERE order_id IN (${placeholders})
  `;
  return await MysqlQueryRunner.runQueryInSlave(query, orderIds);
};

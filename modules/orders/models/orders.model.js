'use strict';

/**
 * Admin order reads are intentionally single-table on `orders` only.
 * Payment plans and users are stitched in the controller via separate keyed lookups (no JOIN hot paths).
 */

const MysqlQueryRunner = require('../../core/models/mysql.promise.model');

/** Column ref for filters; values come from X-Device-OS at order creation */
const CLIENT_PLATFORM_COL = 'o.client_platform';

/** Canonical DB value (ENUM); avoids LOWER(column) which prevents index use on payment_gateway. */
const GATEWAY_GOOGLE_PLAY = 'google_play';

/**
 * Single-table: payment plan ids that match the admin "product type" bucket (for filtering orders by payment_plan_id).
 * @param {string} productType - alacarte | addon | onetime | subscription
 * @returns {Promise<number[]>} pp_id list (may be empty)
 */
exports.getPpIdsMatchingProductType = async function (productType) {
  const pt = productType && String(productType).trim();
  if (!pt) return [];
  if (pt === 'alacarte') {
    const q = `
      SELECT pp_id FROM payment_plans
      WHERE plan_type IN ('single', 'bundle') AND billing_interval = 'alacarte'
    `;
    const rows = await MysqlQueryRunner.runQueryInSlave(q, []);
    return rows.map((r) => r.pp_id).filter((id) => id != null);
  }
  if (pt === 'addon') {
    const q = `
      SELECT pp_id FROM payment_plans
      WHERE plan_type = 'addon' AND billing_interval = 'onetime'
    `;
    const rows = await MysqlQueryRunner.runQueryInSlave(q, []);
    return rows.map((r) => r.pp_id).filter((id) => id != null);
  }
  if (pt === 'onetime') {
    const q = `
      SELECT pp_id FROM payment_plans
      WHERE plan_type = 'credits'
        AND (billing_interval IS NULL OR billing_interval NOT IN ('monthly', 'yearly'))
    `;
    const rows = await MysqlQueryRunner.runQueryInSlave(q, []);
    return rows.map((r) => r.pp_id).filter((id) => id != null);
  }
  if (pt === 'subscription') {
    const q = `
      SELECT pp_id FROM payment_plans
      WHERE plan_type = 'credits' AND billing_interval IN ('monthly', 'yearly')
    `;
    const rows = await MysqlQueryRunner.runQueryInSlave(q, []);
    return rows.map((r) => r.pp_id).filter((id) => id != null);
  }
  return [];
};

/**
 * @param {{ status?: string, productType?: string, search?: string, client_platform?: string, payment_gateway?: string, createdAtFrom?: string, createdAtTo?: string, orderIdFrom?: number, orderIdTo?: number, _noMatchingPlans?: boolean }} filters
 * @returns {{ whereSql: string, params: any[] }}
 */
function buildAdminOrdersWhere(filters) {
  const where = ['1=1'];
  const params = [];
  const status = filters.status && String(filters.status).trim();
  const productType = filters.productType && String(filters.productType).trim();
  const search = filters.search && String(filters.search).trim();
  const client_platform = filters.client_platform && String(filters.client_platform).trim().toLowerCase();
  const payment_gateway = filters.payment_gateway && String(filters.payment_gateway).trim().toLowerCase();

  if (status && ['created', 'completed', 'failed'].includes(status)) {
    where.push('o.status = ?');
    params.push(status);
  }

  if (payment_gateway === 'google_play') {
    where.push('o.payment_gateway = ?');
    params.push(GATEWAY_GOOGLE_PLAY);
  }

  if (productType && ['alacarte', 'addon', 'onetime', 'subscription'].includes(productType)) {
    if (filters._noMatchingPlans) {
      where.push('0=1');
    } else {
      where.push('o.payment_plan_id IN (?)');
      params.push(filters._ppIdsForProductType || []);
    }
  }

  if (search) {
    const term = `%${search}%`;
    // No CAST on order_id — MySQL compares LIKE against numeric columns using string conversion;
    // avoids expression wrapping that can limit optimizer choices vs CAST(... AS CHAR).
    where.push('(o.user_id LIKE ? OR o.order_id LIKE ?)');
    params.push(term, term);
  }

  if (client_platform === 'android' || client_platform === 'ios' || client_platform === 'web') {
    where.push(`${CLIENT_PLATFORM_COL} = ?`);
    params.push(client_platform);
  }

  if (filters.createdAtFrom) {
    where.push('o.created_at >= ?');
    params.push(filters.createdAtFrom);
  }
  if (filters.createdAtTo) {
    where.push('o.created_at <= ?');
    params.push(filters.createdAtTo);
  }
  if (filters.orderIdFrom != null && Number.isFinite(Number(filters.orderIdFrom))) {
    where.push('o.order_id >= ?');
    params.push(Number(filters.orderIdFrom));
  }
  if (filters.orderIdTo != null && Number.isFinite(Number(filters.orderIdTo))) {
    where.push('o.order_id <= ?');
    params.push(Number(filters.orderIdTo));
  }

  return { whereSql: where.join(' AND '), params };
}

const ORDERS_ADMIN_SELECT = `
  SELECT
    o.order_id,
    o.user_id,
    o.payment_gateway,
    o.client_platform,
    o.pg_order_id,
    o.quantity,
    o.pg_payment_id,
    o.payment_plan_id,
    o.amount_paid,
    o.currency,
    o.payment_method,
    o.status,
    o.transaction_notes,
    o.created_at,
    o.completed_at,
    o.failed_at,
    o.refunded_at
  FROM orders o
`;

/**
 * Resolves product-type → payment_plan ids once (avoid duplicate queries when listing + counting).
 * @param {{ status?: string, productType?: string, search?: string, client_platform?: string, payment_gateway?: string, createdAtFrom?: string, createdAtTo?: string, orderIdFrom?: number, orderIdTo?: number }} filters
 */
async function resolveAdminFilterPayload(filters) {
  if (filters._ppIdsResolved) return filters;
  const productType = filters.productType && String(filters.productType).trim();
  let _ppIdsForProductType;
  let _noMatchingPlans = false;
  if (productType && ['alacarte', 'addon', 'onetime', 'subscription'].includes(productType)) {
    _ppIdsForProductType = await exports.getPpIdsMatchingProductType(productType);
    if (_ppIdsForProductType.length === 0) {
      _noMatchingPlans = true;
    }
  }
  return {
    ...filters,
    _ppIdsForProductType,
    _noMatchingPlans,
    _ppIdsResolved: true
  };
}

exports.prepareAdminOrdersFilters = resolveAdminFilterPayload;

/**
 * Admin list: orders only (plan columns stitched in controller). Filters by status, product bucket, search, client_platform.
 * @param {{ limit: number, offset: number, status?: string, productType?: string, search?: string, client_platform?: string, payment_gateway?: string, createdAtFrom?: string, createdAtTo?: string, orderIdFrom?: number, orderIdTo?: number }} filters
 * @returns {Promise<Array>}
 */
exports.listOrdersAdmin = async function (filters) {
  const { limit, offset } = filters;
  const resolved = await resolveAdminFilterPayload(filters);
  const { whereSql, params } = buildAdminOrdersWhere(resolved);
  const query = `
    ${ORDERS_ADMIN_SELECT}
    WHERE ${whereSql}
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `;
  return await MysqlQueryRunner.runQueryInSlave(query, [...params, limit, offset]);
};

/**
 * @param {{ status?: string, productType?: string, search?: string, client_platform?: string, payment_gateway?: string, createdAtFrom?: string, createdAtTo?: string, orderIdFrom?: number, orderIdTo?: number }} filters
 * @returns {Promise<number>}
 */
exports.countOrdersAdmin = async function (filters) {
  const resolved = await resolveAdminFilterPayload(filters);
  const { whereSql, params } = buildAdminOrdersWhere(resolved);
  const query = `
    SELECT COUNT(*) AS total
    FROM orders o
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
           transaction_notes,
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

/**
 * Count orders we can look up on Play (have pg_order_id + google_play gateway).
 * Uses `pg_order_id <> ''` (not TRIM) so the predicate stays index-friendly; normalize whitespace in data if needed.
 */
exports.countGooglePlayOrdersWithPgIdAdmin = async function () {
  const query = `
    SELECT COUNT(*) AS total
    FROM orders o
    WHERE o.payment_gateway = ?
      AND o.pg_order_id IS NOT NULL
      AND o.pg_order_id <> ''
  `;
  const rows = await MysqlQueryRunner.runQueryInSlave(query, [GATEWAY_GOOGLE_PLAY]);
  const r = rows && rows[0];
  const n = r && r.total != null ? Number(r.total) : 0;
  return Number.isFinite(n) ? n : 0;
};

/**
 * Paginated list of google_play orders with pg_order_id (Play ID index only).
 */
exports.listGooglePlayOrdersWithPgIdAdmin = async function ({ limit, offset }) {
  const query = `
    ${ORDERS_ADMIN_SELECT}
    WHERE o.payment_gateway = ?
      AND o.pg_order_id IS NOT NULL
      AND o.pg_order_id <> ''
    ORDER BY o.created_at DESC
    LIMIT ? OFFSET ?
  `;
  return await MysqlQueryRunner.runQueryInSlave(query, [GATEWAY_GOOGLE_PLAY, limit, offset]);
};

/**
 * Internal orders that may match RTDN / orphan queue rows (by Play order id or stored purchase token on `pg_payment_id`).
 */
exports.findGooglePlayOrdersMatchingOrphans = async function ({ pgOrderIds, purchaseTokens }) {
  const pids = [...new Set((pgOrderIds || []).map((x) => (x != null ? String(x).trim() : '')).filter(Boolean))];
  const toks = [...new Set((purchaseTokens || []).map((x) => (x != null ? String(x).trim() : '')).filter(Boolean))];
  if (pids.length === 0 && toks.length === 0) return [];

  const parts = [];
  const params = [GATEWAY_GOOGLE_PLAY];
  if (pids.length > 0) {
    parts.push(`o.pg_order_id IN (${pids.map(() => '?').join(',')})`);
    params.push(...pids);
  }
  if (toks.length > 0) {
    parts.push(`o.pg_payment_id IN (${toks.map(() => '?').join(',')})`);
    params.push(...toks);
  }
  const whereOr = parts.join(' OR ');
  const query = `
    ${ORDERS_ADMIN_SELECT}
    WHERE o.payment_gateway = ?
      AND (${whereOr})
  `;
  return await MysqlQueryRunner.runQueryInSlave(query, params);
};


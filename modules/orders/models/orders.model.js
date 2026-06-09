'use strict';

/**
 * Admin order reads are intentionally single-table on `orders` only.
 * Payment plans and users are stitched in the controller via separate keyed lookups (no JOIN hot paths).
 */

const MysqlQueryRunner = require('../../core/models/mysql.promise.model');
const moment = require('moment-timezone');

/** Column ref for filters; values come from X-Device-OS at order creation */
const CLIENT_PLATFORM_COL = 'o.client_platform';

/** Canonical DB value (ENUM); avoids LOWER(column) which prevents index use on payment_gateway. */
const GATEWAY_GOOGLE_PLAY = 'google_play';
const GATEWAY_APPLE_IAP = 'apple_iap';

/**
 * Single-table: payment plan ids that match the admin "product type" bucket (for filtering orders by payment_plan_id).
 * @param {string} productType - alacarte | addon | onetime | subscription | subscription_renewal
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
  if (pt === 'subscription_renewal') {
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

  if (productType && ['alacarte', 'addon', 'onetime', 'subscription', 'subscription_renewal'].includes(productType)) {
    if (filters._noMatchingPlans) {
      where.push('0=1');
    } else {
      where.push('o.payment_plan_id IN (?)');
      params.push(filters._ppIdsForProductType || []);

      if (productType === 'subscription') {
        where.push(`
          (
            o.transaction_notes IS NULL
            OR NOT JSON_VALID(o.transaction_notes)
            OR LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(o.transaction_notes, '$.purchase_subject')))) <> 'subscription_renewal'
          )
        `);
      } else if (productType === 'subscription_renewal') {
        where.push(`
          JSON_VALID(o.transaction_notes)
          AND LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(o.transaction_notes, '$.purchase_subject')))) = 'subscription_renewal'
        `);
      }
    }
  }

  if (search) {
    const term = `%${search}%`;
    // No CAST on order_id — MySQL compares LIKE against numeric columns using string conversion;
    // avoids expression wrapping that can limit optimizer choices vs CAST(... AS CHAR).
    where.push('(o.user_id LIKE ? OR o.order_id LIKE ? OR o.device_id LIKE ?)');
    params.push(term, term, term);
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

/** Distinct purchaser anchor for admin user counts (logged-in user or guest device). */
const PURCHASER_DISTINCT_EXPR = `CASE
  WHEN o.user_id IS NOT NULL THEN CONCAT('user:', o.user_id)
  WHEN o.device_id IS NOT NULL THEN CONCAT('device:', o.device_id)
  ELSE NULL
END`;

const ORDERS_ADMIN_SELECT = `
  SELECT
    o.order_id,
    o.user_id,
    o.device_id,
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
  if (productType && ['alacarte', 'addon', 'onetime', 'subscription', 'subscription_renewal'].includes(productType)) {
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
 * Calendar day in `tz` for one UTC order timestamp (matches admin UI Intl local-day keys).
 * Implemented in Node so MySQL does not rely on time_zone tables for CONVERT_TZ.
 * @param {string|Date} tsVal
 * @param {string} tz IANA
 */
function calendarDayKeyFromCreatedAt(tsVal, tz) {
  if (tsVal == null) return null;
  const m = tsVal instanceof Date ? moment.utc(tsVal) : moment.utc(String(tsVal).trim());
  if (!m.isValid()) return null;
  return m.tz(tz).format('YYYY-MM-DD');
}

exports.calendarDayKeyFromCreatedAt = calendarDayKeyFromCreatedAt;

/**
 * Distinct users matching admin list filters (single aggregate, no joins).
 * @param {{ status?: string, productType?: string, search?: string, client_platform?: string, payment_gateway?: string, createdAtFrom?: string, createdAtTo?: string, orderIdFrom?: number, orderIdTo?: number }} filters
 * @returns {Promise<number>}
 */
exports.countDistinctUsersAdmin = async function (filters) {
  const resolved = await resolveAdminFilterPayload(filters);
  const { whereSql, params } = buildAdminOrdersWhere(resolved);
  const query = `
    SELECT COUNT(DISTINCT ${PURCHASER_DISTINCT_EXPR}) AS n
    FROM orders o
    WHERE ${whereSql}
  `;
  const rows = await MysqlQueryRunner.runQueryInSlave(query, params);
  const n = rows && rows[0] && rows[0].n != null ? Number(rows[0].n) : 0;
  return Number.isFinite(n) ? n : 0;
};

/**
 * Max calendar span (min→max local day) for which we use **one** `orders` range scan and bucket in Node.
 * Wider spans use per-day aggregate queries only (still no joins).
 */
const ADMIN_ORDER_DAY_SUMMARY_SINGLE_SCAN_MAX_SPAN_DAYS = 14;

/**
 * Bucket orders into calendar days (same TZ semantics as the admin list).
 * @param {Array<{ ca: unknown, uid: unknown, cur: unknown, amt: unknown }>} rows
 * @param {string} tz
 * @param {Set<string>} wantedDayKeys
 */
function purchaserAnchorFromAdminRow(row) {
  const uid = row.uid;
  if (uid != null && uid !== '') return `user:${String(uid)}`;
  const did = row.did;
  if (did != null && did !== '') return `device:${String(did)}`;
  return null;
}

function aggregateAdminOrderDayRows(rows, tz, wantedDayKeys) {
  /** @type {Map<string, { count: number, users: Set<string>, rev: Map<string, number> }>} */
  const byDay = new Map();
  for (const row of rows || []) {
    const dk = calendarDayKeyFromCreatedAt(row.ca, tz);
    if (!dk || !wantedDayKeys.has(dk)) continue;
    let agg = byDay.get(dk);
    if (!agg) {
      agg = { count: 0, users: new Set(), rev: new Map() };
      byDay.set(dk, agg);
    }
    agg.count += 1;
    const anchor = purchaserAnchorFromAdminRow(row);
    if (anchor) agg.users.add(anchor);
    const curRaw = row.cur != null ? String(row.cur).trim() : '';
    const curKey = curRaw === '' ? '__NONE__' : curRaw;
    const amt = Number(row.amt) || 0;
    agg.rev.set(curKey, (agg.rev.get(curKey) || 0) + amt);
  }
  return byDay;
}

function buildOrdersByCalendarDayPayload(sortedAsc, byDay) {
  const descending = [...sortedAsc].reverse();
  return descending.map((dayKey) => {
    const agg = byDay.get(dayKey);
    if (!agg) {
      return {
        day_key: dayKey,
        order_count: 0,
        unique_users: 0,
        revenue_by_currency: []
      };
    }
    const revenue_by_currency = [...agg.rev.entries()]
      .map(([currency_key, amount]) => ({
        currency: currency_key === '__NONE__' ? '' : currency_key,
        amount
      }))
      .filter((x) => x.amount !== 0)
      .sort((a, b) => b.amount - a.amount);
    return {
      day_key: dayKey,
      order_count: agg.count,
      unique_users: agg.users.size,
      revenue_by_currency
    };
  });
}

/** One range scan + in-memory buckets (no joins). */
async function summarizeAdminOrdersCalendarDaysSingleScan(whereSql, params, tz, sortedAsc) {
  const firstDay = sortedAsc[0];
  const lastDay = sortedAsc[sortedAsc.length - 1];
  const rangeStartUtc = moment.tz(`${firstDay} 00:00:00.000`, tz).utc();
  const rangeEndUtc = moment.tz(`${lastDay} 00:00:00.000`, tz).utc().add(1, 'day');
  const bind = [...params, rangeStartUtc.format('YYYY-MM-DD HH:mm:ss.SSS'), rangeEndUtc.format('YYYY-MM-DD HH:mm:ss.SSS')];

  const q = `
    SELECT
      o.created_at AS ca,
      o.user_id AS uid,
      o.device_id AS did,
      COALESCE(NULLIF(TRIM(o.currency), ''), '') AS cur,
      o.amount_paid AS amt
    FROM orders o
    WHERE ${whereSql} AND o.created_at >= ? AND o.created_at < ?
  `;
  const rows = await MysqlQueryRunner.runQueryInSlave(q, bind);
  const wanted = new Set(sortedAsc);
  const byDay = aggregateAdminOrderDayRows(rows, tz, wanted);
  const orders_by_calendar_day = buildOrdersByCalendarDayPayload(sortedAsc, byDay);
  return {
    distinct_calendar_days: orders_by_calendar_day.length,
    orders_by_calendar_day
  };
}

/** Parallel per-day aggregates only (indexed range per day, no joins). Used when calendar span is large. */
async function summarizeAdminOrdersCalendarDaysPerDayAggregates(whereSql, params, tz, sortedAsc) {
  const sortedDesc = [...sortedAsc].reverse();
  const tasks = sortedDesc.map(async (dayKey) => {
    const startUtc = moment.tz(`${dayKey} 00:00:00.000`, tz).utc();
    const endUtc = startUtc.clone().add(1, 'day');
    const bind = [...params, startUtc.format('YYYY-MM-DD HH:mm:ss.SSS'), endUtc.format('YYYY-MM-DD HH:mm:ss.SSS')];

    const qCount = `
      SELECT COUNT(*) AS order_count, COUNT(DISTINCT ${PURCHASER_DISTINCT_EXPR}) AS unique_users
      FROM orders o
      WHERE ${whereSql} AND o.created_at >= ? AND o.created_at < ?
    `;
    const qRev = `
      SELECT
        COALESCE(NULLIF(TRIM(o.currency), ''), '__NONE__') AS currency_key,
        COALESCE(SUM(o.amount_paid), 0) AS amount
      FROM orders o
      WHERE ${whereSql} AND o.created_at >= ? AND o.created_at < ?
      GROUP BY COALESCE(NULLIF(TRIM(o.currency), ''), '__NONE__')
    `;

    const [countRows, revRows] = await Promise.all([
      MysqlQueryRunner.runQueryInSlave(qCount, bind),
      MysqlQueryRunner.runQueryInSlave(qRev, bind)
    ]);

    const r = countRows && countRows[0];
    const revenue_by_currency = (revRows || [])
      .map((row) => ({
        currency: row.currency_key === '__NONE__' ? '' : String(row.currency_key || '').trim(),
        amount: Number(row.amount) || 0
      }))
      .filter((x) => x.amount !== 0)
      .sort((a, b) => b.amount - a.amount);

    return {
      day_key: dayKey,
      order_count: Number(r?.order_count) || 0,
      unique_users: Number(r?.unique_users) || 0,
      revenue_by_currency
    };
  });

  const orders_by_calendar_day = await Promise.all(tasks);
  return {
    distinct_calendar_days: orders_by_calendar_day.length,
    orders_by_calendar_day
  };
}

/**
 * Per calendar-day counts for **only** the given local dates (YYYY-MM-DD in `tz`).
 * Uses **one** indexed `orders` scan when the min/max calendar span is small; otherwise parallel
 * **per-day aggregate** queries (no joins, no subqueries).
 *
 * @param {{ status?: string, productType?: string, search?: string, client_platform?: string, payment_gateway?: string, createdAtFrom?: string, createdAtTo?: string, orderIdFrom?: number, orderIdTo?: number }} filters
 * @param {string} tz IANA (must match admin UI day grouping)
 * @param {string[]} dayKeys YYYY-MM-DD, typically from the current page’s `created_at` values
 * @returns {Promise<{ distinct_calendar_days: number, orders_by_calendar_day: Array<{ day_key: string, order_count: number, unique_users: number, revenue_by_currency: Array<{ currency: string, amount: number }> }> }>}
 */
exports.summarizeAdminOrdersForCalendarDays = async function (filters, tz, dayKeys) {
  const sortedAsc = [...new Set(dayKeys || [])]
    .filter((k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k.trim()))
    .sort((a, b) => a.localeCompare(b));
  if (sortedAsc.length === 0) {
    return { distinct_calendar_days: 0, orders_by_calendar_day: [] };
  }

  const resolved = await resolveAdminFilterPayload(filters);
  const { whereSql, params } = buildAdminOrdersWhere(resolved);

  const firstDay = sortedAsc[0];
  const lastDay = sortedAsc[sortedAsc.length - 1];
  const spanDays = moment.tz(lastDay, 'YYYY-MM-DD', tz).diff(moment.tz(firstDay, 'YYYY-MM-DD', tz), 'days');

  if (spanDays <= ADMIN_ORDER_DAY_SUMMARY_SINGLE_SCAN_MAX_SPAN_DAYS) {
    return summarizeAdminOrdersCalendarDaysSingleScan(whereSql, params, tz, sortedAsc);
  }
  return summarizeAdminOrdersCalendarDaysPerDayAggregates(whereSql, params, tz, sortedAsc);
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
 * Guest device orders (pre-sign-in checkout anchor).
 * @param {string} deviceId
 * @param {number} limit
 * @param {number} offset
 */
exports.getByDeviceId = async function (deviceId, limit, offset) {
  const query = `
    SELECT order_id, user_id, device_id, payment_gateway, pg_order_id, quantity, pg_payment_id,
           payment_plan_id, amount_paid, currency, payment_method, status,
           transaction_notes,
           created_at, completed_at, failed_at, refunded_at
    FROM orders
    WHERE device_id = ? AND user_id IS NULL
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  return await MysqlQueryRunner.runQueryInSlave(query, [deviceId, limit, offset]);
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

/**
 * Internal orders that may match Apple ASN2 / verify orphan rows.
 * Match strategy (in priority order, but all OR'd in SQL — controller picks best per orphan row):
 *   - by Apple transactionId stored on `pg_payment_id` (set by verifyApplePayment when it succeeded)
 *   - by `apple_app_account_token` (UUID we generated at order creation; only true Apple-side link for deferred fulfillments)
 *
 * Selecting `apple_app_account_token` so the controller can index matches client-side.
 */
exports.findAppleOrdersMatchingOrphans = async function ({ transactionIds, appAccountTokens }) {
  const txIds = [...new Set((transactionIds || []).map((x) => (x != null ? String(x).trim() : '')).filter(Boolean))];
  const tokens = [...new Set((appAccountTokens || []).map((x) => (x != null ? String(x).trim() : '')).filter(Boolean))];
  if (txIds.length === 0 && tokens.length === 0) return [];

  const parts = [];
  const params = [GATEWAY_APPLE_IAP];
  if (txIds.length > 0) {
    parts.push(`o.pg_payment_id IN (${txIds.map(() => '?').join(',')})`);
    params.push(...txIds);
  }
  if (tokens.length > 0) {
    parts.push(`o.apple_app_account_token IN (${tokens.map(() => '?').join(',')})`);
    params.push(...tokens);
  }
  const whereOr = parts.join(' OR ');
  const query = `
    SELECT
      o.order_id,
      o.user_id,
      o.payment_gateway,
      o.client_platform,
      o.pg_order_id,
      o.quantity,
      o.pg_payment_id,
      o.apple_app_account_token,
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
    WHERE o.payment_gateway = ?
      AND (${whereOr})
  `;
  return await MysqlQueryRunner.runQueryInSlave(query, params);
};


'use strict';

const MysqlQueryRunner = require('../../core/models/mysql.promise.model');
const moment = require('moment-timezone');

/**
 * pp_id rows → numeric ids (matches orders.payment_plan_id).
 * @param {Array<{ pp_id?: unknown }>} rows
 * @returns {number[]}
 */
function mapPpIdRows(rows) {
  return (rows || [])
    .map((r) => (r.pp_id != null ? Number(r.pp_id) : null))
    .filter((id) => id != null && !Number.isNaN(id));
}

/**
 * Resolve payment_plan ids for Purchases chart / filters using payment_plans only (no join on orders).
 *
 * Classification (aligned with product rules):
 * - subscription: credits + (monthly | yearly)
 * - onetime: credits and not recurring (onetime, NULL, etc. — not monthly/yearly)
 * - alacarte: (single | bundle) + alacarte
 * - addon: addon + onetime
 *
 * @param {string} productType alacarte | subscription | onetime | addon
 * @returns {Promise<number[]|null>} null if productType invalid/empty; [] if no plans match
 */
async function getPpIdsForProductFilter(productType) {
  const t = String(productType || '').trim();
  if (!t) {
    return null;
  }

  // Migrations: payment_plans.billing_interval was originally ENUM('onetime') only, then added
  // monthly/yearly/alacarte (e.g. 20260306153000, 20260313140000). Legacy single/bundle rows use
  // 'onetime', not 'alacarte' — must match both or the filter returns [] and the API adds AND 1=0.
  if (t === 'alacarte') {
    const rows = await MysqlQueryRunner.runQueryInSlave(
      `SELECT pp_id FROM payment_plans
       WHERE plan_type IN ('single', 'bundle')
         AND billing_interval IN ('alacarte', 'onetime')`,
      []
    );
    return mapPpIdRows(rows);
  }

  if (t === 'subscription') {
    const rows = await MysqlQueryRunner.runQueryInSlave(
      `SELECT pp_id FROM payment_plans
       WHERE plan_type = 'credits' AND billing_interval IN ('monthly', 'yearly')`,
      []
    );
    return mapPpIdRows(rows);
  }

  if (t === 'onetime') {
    const rows = await MysqlQueryRunner.runQueryInSlave(
      `SELECT pp_id FROM payment_plans
       WHERE plan_type = 'credits'
         AND (billing_interval IS NULL OR billing_interval NOT IN ('monthly', 'yearly'))`,
      []
    );
    return mapPpIdRows(rows);
  }

  if (t === 'addon') {
    const rows = await MysqlQueryRunner.runQueryInSlave(
      `SELECT pp_id FROM payment_plans
       WHERE plan_type = 'addon' AND billing_interval = 'onetime'`,
      []
    );
    return mapPpIdRows(rows);
  }

  return null;
}

/**
 * @param {string} startCal YYYY-MM-DD
 * @param {string} endCal YYYY-MM-DD
 * @param {string} tz IANA
 * @returns {{ rangeStartUtc: string, rangeEndUtc: string }}
 */
function utcRangeForCalendarDays(startCal, endCal, tz) {
  const rangeStartUtc = moment.tz(`${startCal} 00:00:00.000`, tz).utc().format('YYYY-MM-DD HH:mm:ss.SSS');
  const rangeEndUtc = moment.tz(`${endCal} 23:59:59.999`, tz).utc().format('YYYY-MM-DD HH:mm:ss.SSS');
  return { rangeStartUtc, rangeEndUtc };
}

/**
 * @param {number[]|null} ppIds null = no plan filter; [] = no matching plans
 * @returns {{ sql: string, params: any[] }}
 */
function planFilterClause(ppIds) {
  if (ppIds === null) {
    return { sql: '', params: [] };
  }
  if (ppIds.length === 0) {
    return { sql: ' AND 1=0 ', params: [] };
  }
  const ph = ppIds.map(() => '?').join(',');
  return { sql: ` AND o.payment_plan_id IN (${ph}) `, params: ppIds };
}

/** @param {...{ sql: string, params: any[] }} parts */
function mergeSqlParts(...parts) {
  return {
    sql: parts.map((p) => (p && p.sql) || '').join(''),
    params: parts.flatMap((p) => (p && p.params) || [])
  };
}

/**
 * Optional gateway slice (must match `orders.payment_gateway` enum values).
 * @param {string} [paymentGateway]
 */
function gatewayFilterClause(paymentGateway) {
  const g = paymentGateway != null ? String(paymentGateway).trim() : '';
  if (!g) return { sql: '', params: [] };
  return { sql: ' AND o.payment_gateway = ? ', params: [g] };
}

/**
 * Calendar day in `tz` for one order timestamp, equivalent to
 * DATE(CONVERT_TZ(col, '+00:00', tz)) when stored times are UTC.
 * Done in Node so MariaDB does not need mysql.time_zone_* tables (named zones).
 * @param {string|Date} tsVal `DATE_FORMAT` string or driver Date
 * @param {string} tz IANA
 */
function calendarDayInTzFromUtcWallTime(tsVal, tz) {
  if (tsVal == null) return null;
  let m;
  if (tsVal instanceof Date) {
    m = moment.utc(tsVal);
  } else {
    const s = String(tsVal).trim();
    if (s === '') return null;
    m = moment.utc(s, 'YYYY-MM-DD HH:mm:ss', true);
  }
  if (!m.isValid()) return null;
  return m.tz(tz).format('YYYY-MM-DD');
}

/**
 * Daily buckets for orders analytics.
 *
 * **created** — all orders whose `created_at` falls in the UTC window (starters in period).
 * **completed** — orders with `status = 'completed'` whose **`created_at`** falls in the window
 *   (cohort: successfully completed among starters — comparable to “created”, not completion-throughput).
 * **failed** — orders with `status = 'failed'` whose **`created_at`** falls in the window
 *   (same cohort so rates vs created are meaningful).
 *
 * @param {string} tz
 * @param {string} rangeStartUtc
 * @param {string} rangeEndUtc
 * @param {{ sql: string, params: any[] }} filterPart plan + optional gateway, etc.
 * @param {'created'|'completed'|'failed'} kind
 */
async function queryDailyByKind(tz, rangeStartUtc, rangeEndUtc, filterPart, kind) {
  let dateFormatCol;
  let whereExtra;
  if (kind === 'created') {
    dateFormatCol = "DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s')";
    whereExtra = 'o.created_at >= ? AND o.created_at <= ?';
  } else if (kind === 'completed') {
    dateFormatCol = "DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s')";
    whereExtra = `o.status = 'completed' AND o.created_at >= ? AND o.created_at <= ?`;
  } else {
    dateFormatCol = "DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i:%s')";
    whereExtra = `o.status = 'failed' AND o.created_at >= ? AND o.created_at <= ?`;
  }

  const query = `
    SELECT ${dateFormatCol} AS ts_utc
    FROM orders o
    WHERE ${whereExtra}
    ${filterPart.sql}
  `;

  const params = [rangeStartUtc, rangeEndUtc, ...filterPart.params];
  const rows = await MysqlQueryRunner.runQueryInSlave(query, params);

  const dayCounts = new Map();
  for (const r of rows || []) {
    const dayKey = calendarDayInTzFromUtcWallTime(r.ts_utc, tz);
    if (dayKey == null) continue;
    dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
  }

  return Array.from(dayCounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({
      date,
      count: Number(count) || 0
    }));
}

/**
 * Period totals for orders analytics (same cohort semantics as {@link queryDailyByKind}).
 */
async function queryCountByKind(rangeStartUtc, rangeEndUtc, filterPart, kind) {
  let whereExtra;
  if (kind === 'created') {
    whereExtra = 'o.created_at >= ? AND o.created_at <= ?';
  } else if (kind === 'completed') {
    whereExtra = `o.status = 'completed' AND o.created_at >= ? AND o.created_at <= ?`;
  } else {
    whereExtra = `o.status = 'failed' AND o.created_at >= ? AND o.created_at <= ?`;
  }

  const query = `
    SELECT COUNT(*) AS total
    FROM orders o
    WHERE ${whereExtra}
    ${filterPart.sql}
  `;

  const params = [rangeStartUtc, rangeEndUtc, ...filterPart.params];
  const rows = await MysqlQueryRunner.runQueryInSlave(query, params);
  const n = rows && rows[0] ? Number(rows[0].total) : 0;
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {Object} opts
 * @param {string} opts.startCal YYYY-MM-DD
 * @param {string} opts.endCal YYYY-MM-DD
 * @param {string} opts.tz IANA timezone
 * @param {string} [opts.productType] alacarte | subscription | onetime | addon
 * @param {string} [opts.paymentGateway] razorpay | google_play | … (optional; matches `orders.payment_gateway`)
 */
exports.getOrdersStatusDaily = async function (opts) {
  const { startCal, endCal, tz, productType, paymentGateway } = opts;

  const { rangeStartUtc, rangeEndUtc } = utcRangeForCalendarDays(startCal, endCal, tz);

  let ppIds = null;
  if (productType && String(productType).trim()) {
    ppIds = await getPpIdsForProductFilter(String(productType).trim());
  }
  const planPart = planFilterClause(ppIds);
  const filterPart = mergeSqlParts(planPart, gatewayFilterClause(paymentGateway));

  const [created, completed] = await Promise.all([
    queryDailyByKind(tz, rangeStartUtc, rangeEndUtc, filterPart, 'created'),
    queryDailyByKind(tz, rangeStartUtc, rangeEndUtc, filterPart, 'completed')
  ]);

  return { created, completed };
};

/**
 * Summary counts for metric cards (cohort: `created_at` in window; completed/failed are subsets of starters).
 * @param {Object} opts
 * @param {string} opts.startCal
 * @param {string} opts.endCal
 * @param {string} opts.tz
 * @param {string} [opts.productType]
 * @param {string} [opts.paymentGateway]
 */
exports.getOrdersStatusSummary = async function (opts) {
  const { startCal, endCal, tz, productType, paymentGateway } = opts;
  const { rangeStartUtc, rangeEndUtc } = utcRangeForCalendarDays(startCal, endCal, tz);

  let ppIds = null;
  if (productType && String(productType).trim()) {
    ppIds = await getPpIdsForProductFilter(String(productType).trim());
  }
  const planPart = planFilterClause(ppIds);
  const filterPart = mergeSqlParts(planPart, gatewayFilterClause(paymentGateway));

  const [created_count, completed_count, failed_count] = await Promise.all([
    queryCountByKind(rangeStartUtc, rangeEndUtc, filterPart, 'created'),
    queryCountByKind(rangeStartUtc, rangeEndUtc, filterPart, 'completed'),
    queryCountByKind(rangeStartUtc, rangeEndUtc, filterPart, 'failed')
  ]);

  const failure_rate_pct =
    created_count > 0 ? Math.round((failed_count / created_count) * 10000) / 100 : 0;
  const completion_rate_pct =
    created_count > 0 ? Math.round((completed_count / created_count) * 10000) / 100 : 0;

  return {
    created_count,
    completed_count,
    failed_count,
    failure_rate_pct,
    completion_rate_pct
  };
};

/**
 * Total orders and distinct users in range (`orders.created_at` in UTC window for calendar days in `tz`).
 * Single aggregate on MySQL `orders` (spoke / source of truth for admin list + CSV export).
 *
 * We intentionally do **not** read ClickHouse `analytics_events_raw` (hub) here: `order_created` event
 * counts can drift from persisted rows (delivery lag, retries, non-emitting paths), and a narrow
 * `COUNT(*)` + `COUNT(DISTINCT user_id)` on an indexed `created_at` range is typically faster and
 * simpler than scanning raw events. Use {@link AnalyticsModel.queryOrdersFunnelClickhouseSummary}
 * when you need hub-scoped funnel dimensions (app_version, product_classification, etc.).
 *
 * `ppIds` must be pre-resolved in the controller (null = no product filter).
 *
 * @param {Object} opts
 * @param {string} opts.startCal YYYY-MM-DD
 * @param {string} opts.endCal YYYY-MM-DD
 * @param {string} opts.tz IANA
 * @param {number[]|null} opts.ppIds payment_plan_id list, or null if not filtering by product bucket
 * @param {string} [opts.paymentGateway]
 * @returns {Promise<{ total_orders: number, unique_users: number }>}
 */
exports.getOrdersVolumeSummary = async function (opts) {
  const { startCal, endCal, tz, ppIds, paymentGateway } = opts;
  const { rangeStartUtc, rangeEndUtc } = utcRangeForCalendarDays(startCal, endCal, tz);

  const planPart = planFilterClause(ppIds);
  const filterPart = mergeSqlParts(planPart, gatewayFilterClause(paymentGateway));

  const query = `
    SELECT COUNT(*) AS total_orders, COUNT(DISTINCT user_id) AS unique_users
    FROM orders o
    WHERE o.created_at >= ? AND o.created_at <= ?${filterPart.sql}
  `;
  const params = [rangeStartUtc, rangeEndUtc, ...filterPart.params];
  const rows = await MysqlQueryRunner.runQueryInSlave(query, params);
  const row = rows && rows[0] ? rows[0] : {};
  return {
    total_orders: Number(row.total_orders) || 0,
    unique_users: Number(row.unique_users) || 0
  };
};

/**
 * Day-wise count of **completed** orders for the subscription product bucket only
 * (credits + monthly/yearly — same definition as {@link getPpIdsForProductFilter} `subscription`).
 *
 * @param {Object} opts
 * @param {string} opts.startCal
 * @param {string} opts.endCal
 * @param {string} opts.tz
 * @param {string} [opts.paymentGateway]
 * @returns {Promise<{ daily: { date: string, count: number }[] }>}
 */
exports.getSubscriptionPurchasesDaily = async function (opts) {
  const { startCal, endCal, tz, paymentGateway } = opts;
  const { rangeStartUtc, rangeEndUtc } = utcRangeForCalendarDays(startCal, endCal, tz);

  const ppIds = await getPpIdsForProductFilter('subscription');
  const planPart = planFilterClause(ppIds);
  const filterPart = mergeSqlParts(planPart, gatewayFilterClause(paymentGateway));

  const daily = await queryDailyByKind(tz, rangeStartUtc, rangeEndUtc, filterPart, 'completed');
  return { daily };
};

/** SQL expression: order row counts as à la carte (matches {@link getPpIdsForProductFilter} `alacarte`). */
const ORDER_IS_ALACARTE_SQL = `
  pp.pp_id IS NOT NULL
  AND pp.plan_type IN ('single', 'bundle')
  AND pp.billing_interval IN ('alacarte', 'onetime')
`;

/** Matches {@link getPpIdsForProductFilter} `addon`. */
const ORDER_IS_ADDON_SQL = `
  pp.pp_id IS NOT NULL
  AND pp.plan_type = 'addon'
  AND pp.billing_interval = 'onetime'
`;

/** Matches {@link getPpIdsForProductFilter} `subscription` (completed orders). */
const ORDER_IS_SUBSCRIPTION_PLAN_SQL = `
  pp.pp_id IS NOT NULL
  AND pp.plan_type = 'credits'
  AND pp.billing_interval IN ('monthly', 'yearly')
`;

/** Matches {@link getPpIdsForProductFilter} `onetime` credit packs (completed orders). */
const ORDER_IS_ONETIME_CREDITS_SQL = `
  pp.pp_id IS NOT NULL
  AND pp.plan_type = 'credits'
  AND (pp.billing_interval IS NULL OR pp.billing_interval NOT IN ('monthly', 'yearly'))
`;

/** Plan upgrade rows — excluded from initial + renewal (matches admin subscription table). */
const SUBSCRIPTION_IS_UPGRADE_SQL = `
  JSON_VALID(s.additional_data)
  AND JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.notes.type')) = 'upgrade'
`;

/**
 * Recurring subscription row counted as new (initial) or renewal — not upgrade / one-time.
 */
const SUBSCRIPTION_IS_INITIAL_OR_RENEWAL_SQL = `
  s.payment_type = 'recurring'
  AND NOT (${SUBSCRIPTION_IS_UPGRADE_SQL})
`;

/** @type {Record<string, string>} */
const PURCHASING_CUSTOMERS_SORT_COLUMNS = {
  last_purchased_at: 'purchasers.last_purchased_at',
  alacarte_purchases: 'purchasers.alacarte_purchases',
  subscription_purchases: 'purchasers.subscription_purchases',
  addon_purchases: 'purchasers.addon_purchases',
  total_purchases: 'purchasers.total_purchases'
};

/**
 * @param {string} [sortBy]
 * @param {string} [sortDir]
 * @returns {string}
 */
function resolvePurchasingCustomersOrderBy(sortBy, sortDir) {
  const key = sortBy != null ? String(sortBy).trim() : '';
  const col =
    PURCHASING_CUSTOMERS_SORT_COLUMNS[key] || PURCHASING_CUSTOMERS_SORT_COLUMNS.last_purchased_at;
  const dir = String(sortDir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `${col} ${dir}, purchasers.user_id DESC`;
}

/**
 * Paginated customers who have purchased at least once (completed order and/or subscription row).
 *
 * Purchase counts are computed in SQL (not summed on the client):
 * - `alacarte_purchases`: completed orders on à la carte plans
 * - `addon_purchases`: completed orders on add-on plans
 * - `subscription_purchases`: initial + renewal subscription rows, plus completed credit /
 *   subscription-plan orders (monthly, yearly, one-time packs)
 * - `total_purchases`: `alacarte + addon + subscription` (all from SQL)
 *
 * @param {Object} opts
 * @param {string} [opts.search] name, email, mobile, or user id fragment
 * @param {number} opts.limit
 * @param {number} opts.offset
 * @param {string} [opts.sortBy]
 * @param {string} [opts.sortDir] asc | desc
 * @param {boolean} [opts.useMaster]
 * @returns {Promise<{ rows: object[], total: number }>}
 */
exports.listPurchasingCustomersForAdmin = async function (opts) {
  const { search = '', limit, offset, sortBy, sortDir, useMaster = false } = opts;
  const orderBySql = resolvePurchasingCustomersOrderBy(sortBy, sortDir);
  const runQuery = useMaster ? MysqlQueryRunner.runQueryInMaster : MysqlQueryRunner.runQueryInSlave;

  const searchTrim = search != null ? String(search).trim() : '';
  let searchClause = '';
  const searchParams = [];
  if (searchTrim) {
    const term = `%${searchTrim}%`;
    searchClause = `
      AND (
        CAST(u.user_id AS CHAR) LIKE ?
        OR COALESCE(u.display_name, '') LIKE ?
        OR COALESCE(u.email, '') LIKE ?
        OR COALESCE(u.mobile, '') LIKE ?
        OR TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) LIKE ?
      )
    `;
    searchParams.push(term, term, term, term, term);
  }

  const baseFrom = `
    FROM user u
    INNER JOIN (
      SELECT user_id FROM orders
      WHERE status = 'completed' AND COALESCE(payment_gateway, '') <> 'admin_grant'
      UNION
      SELECT user_id FROM subscriptions
    ) eligible ON eligible.user_id = u.user_id
    LEFT JOIN (
      SELECT
        o.user_id,
        SUM(CASE WHEN ${ORDER_IS_ALACARTE_SQL} THEN 1 ELSE 0 END) AS alacarte_purchases,
        SUM(CASE WHEN ${ORDER_IS_ADDON_SQL} THEN 1 ELSE 0 END) AS addon_purchases,
        SUM(
          CASE
            WHEN ${ORDER_IS_SUBSCRIPTION_PLAN_SQL} THEN 1
            WHEN ${ORDER_IS_ONETIME_CREDITS_SQL} THEN 1
            WHEN pp.pp_id IS NULL THEN 1
            ELSE 0
          END
        ) AS subscription_order_purchases,
        MAX(COALESCE(o.completed_at, o.created_at)) AS last_order_at
      FROM orders o
      LEFT JOIN payment_plans pp ON pp.pp_id = o.payment_plan_id
      WHERE o.status = 'completed' AND COALESCE(o.payment_gateway, '') <> 'admin_grant'
      GROUP BY o.user_id
    ) ostats ON ostats.user_id = u.user_id
    LEFT JOIN (
      SELECT
        s.user_id,
        COUNT(*) AS subscription_purchases,
        MAX(COALESCE(s.start_at, s.created_at)) AS last_subscription_at
      FROM subscriptions s
      WHERE ${SUBSCRIPTION_IS_INITIAL_OR_RENEWAL_SQL}
      GROUP BY s.user_id
    ) sstats ON sstats.user_id = u.user_id
    WHERE (u.DELETED_AT IS NULL)
    ${searchClause}
  `;

  const aggSelect = `
    SELECT
      u.user_id,
      COALESCE(
        NULLIF(TRIM(u.display_name), ''),
        NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''),
        NULLIF(TRIM(u.email), ''),
        CAST(u.user_id AS CHAR)
      ) AS user_name,
      u.email AS user_email,
      u.mobile AS user_mobile,
      u.display_name AS user_display_name,
      u.first_name AS user_first_name,
      u.last_name AS user_last_name,
      COALESCE(ostats.alacarte_purchases, 0) AS alacarte_purchases,
      COALESCE(ostats.addon_purchases, 0) AS addon_purchases,
      COALESCE(sstats.subscription_purchases, 0) + COALESCE(ostats.subscription_order_purchases, 0) AS subscription_purchases,
      COALESCE(ostats.alacarte_purchases, 0)
        + COALESCE(ostats.addon_purchases, 0)
        + COALESCE(sstats.subscription_purchases, 0)
        + COALESCE(ostats.subscription_order_purchases, 0) AS total_purchases,
      GREATEST(
        COALESCE(ostats.last_order_at, '1970-01-01 00:00:00'),
        COALESCE(sstats.last_subscription_at, '1970-01-01 00:00:00')
      ) AS last_purchased_at
    ${baseFrom}
  `;

  const countQuery = `
    SELECT COUNT(*) AS cnt
    FROM (
      ${aggSelect}
    ) purchasers
    WHERE purchasers.total_purchases > 0
  `;
  const countRows = await runQuery(countQuery, [...searchParams]);
  const total = Number(countRows[0]?.cnt || 0) || 0;

  const listQuery = `
    SELECT * FROM (
      ${aggSelect}
    ) purchasers
    WHERE purchasers.total_purchases > 0
    ORDER BY ${orderBySql}
    LIMIT ? OFFSET ?
  `;
  const rows = await runQuery(listQuery, [...searchParams, limit, offset]);
  return { rows: rows || [], total };
};

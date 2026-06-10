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

  if (t === 'subscription_renewal') {
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
 * UTC bounds for a client-calendar day range.
 * Returns Date objects for MySQL params — naive UTC strings are interpreted in the server
 * session timezone and break non-UTC dashboard timezones.
 *
 * @param {string} startCal YYYY-MM-DD
 * @param {string} endCal YYYY-MM-DD
 * @param {string} tz IANA
 * @returns {{ rangeStartUtc: string, rangeEndUtc: string, rangeStartDate: Date, rangeEndDate: Date }}
 */
function utcRangeForCalendarDays(startCal, endCal, tz) {
  const rangeStartMoment = moment.tz(`${startCal} 00:00:00.000`, tz).utc();
  const rangeEndMoment = moment.tz(`${endCal} 23:59:59.999`, tz).utc();
  return {
    rangeStartUtc: rangeStartMoment.format('YYYY-MM-DD HH:mm:ss.SSS'),
    rangeEndUtc: rangeEndMoment.format('YYYY-MM-DD HH:mm:ss.SSS'),
    rangeStartDate: rangeStartMoment.toDate(),
    rangeEndDate: rangeEndMoment.toDate()
  };
}

/** @param {{ rangeStartDate: Date, rangeEndDate: Date }} range */
function mysqlUtcRangeParams(range) {
  return [range.rangeStartDate, range.rangeEndDate];
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

/** Renewal ledger rows on orders (purchase_subject stored in JSON). */
const ORDER_NOTE_IS_SUBSCRIPTION_RENEWAL_SQL = `
  JSON_VALID(o.transaction_notes)
  AND LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(o.transaction_notes, '$.purchase_subject')))) = 'subscription_renewal'
`;

/**
 * Narrow broad "subscription" plan bucket vs explicit renewal ledger-only bucket.
 */
function subscriptionRenewalLedgerFilterPart(productTypeTrim) {
  const t = productTypeTrim && String(productTypeTrim).trim();
  if (!t) return { sql: '', params: [] };
  if (t === 'subscription_renewal') {
    return { sql: ` AND (${ORDER_NOTE_IS_SUBSCRIPTION_RENEWAL_SQL}) `, params: [] };
  }
  if (t === 'subscription') {
    return {
      sql: ` AND (
          o.transaction_notes IS NULL
          OR NOT JSON_VALID(o.transaction_notes)
          OR NOT (${ORDER_NOTE_IS_SUBSCRIPTION_RENEWAL_SQL})
      ) `,
      params: []
    };
  }
  return { sql: '', params: [] };
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
async function queryDailyByKind(tz, rangeStartDate, rangeEndDate, filterPart, kind) {
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

  const params = [rangeStartDate, rangeEndDate, ...filterPart.params];
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
async function queryCountByKind(rangeStartDate, rangeEndDate, filterPart, kind) {
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

  const params = [rangeStartDate, rangeEndDate, ...filterPart.params];
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

  const range = utcRangeForCalendarDays(startCal, endCal, tz);

  let ppIds = null;
  if (productType && String(productType).trim()) {
    ppIds = await getPpIdsForProductFilter(String(productType).trim());
  }
  const planPart = planFilterClause(ppIds);
  const ledgerPart = subscriptionRenewalLedgerFilterPart(productType && String(productType).trim());
  const filterPart = mergeSqlParts(planPart, ledgerPart, gatewayFilterClause(paymentGateway));

  const [created, completed] = await Promise.all([
    queryDailyByKind(tz, range.rangeStartDate, range.rangeEndDate, filterPart, 'created'),
    queryDailyByKind(tz, range.rangeStartDate, range.rangeEndDate, filterPart, 'completed')
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
  const range = utcRangeForCalendarDays(startCal, endCal, tz);

  let ppIds = null;
  if (productType && String(productType).trim()) {
    ppIds = await getPpIdsForProductFilter(String(productType).trim());
  }
  const planPart = planFilterClause(ppIds);
  const ledgerPart = subscriptionRenewalLedgerFilterPart(productType && String(productType).trim());
  const filterPart = mergeSqlParts(planPart, ledgerPart, gatewayFilterClause(paymentGateway));

  const [created_count, completed_count, failed_count] = await Promise.all([
    queryCountByKind(range.rangeStartDate, range.rangeEndDate, filterPart, 'created'),
    queryCountByKind(range.rangeStartDate, range.rangeEndDate, filterPart, 'completed'),
    queryCountByKind(range.rangeStartDate, range.rangeEndDate, filterPart, 'failed')
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
 * @param {string} [opts.productTypeLedger] alacarte|subscription|subscription_renewal|… — narrows subscription vs renewal ledger rows
 * @returns {Promise<{ total_orders: number, unique_users: number }>}
 */
exports.getOrdersVolumeSummary = async function (opts) {
  const { startCal, endCal, tz, ppIds, paymentGateway, productTypeLedger } = opts;
  const range = utcRangeForCalendarDays(startCal, endCal, tz);

  const planPart = planFilterClause(ppIds);
  const ledgerPart = subscriptionRenewalLedgerFilterPart(productTypeLedger && String(productTypeLedger).trim());
  const filterPart = mergeSqlParts(planPart, ledgerPart, gatewayFilterClause(paymentGateway));

  const query = `
    SELECT
      COUNT(*) AS total_orders,
      COUNT(DISTINCT COALESCE(
        NULLIF(TRIM(CONCAT('user:', CAST(o.user_id AS CHAR) COLLATE utf8mb4_unicode_ci)), 'user:'),
        NULLIF(TRIM(CONCAT('device:', CONVERT(o.device_id USING utf8mb4) COLLATE utf8mb4_unicode_ci)), 'device:')
      )) AS unique_users
    FROM orders o
    WHERE o.created_at >= ? AND o.created_at <= ?${filterPart.sql}
  `;
  const params = [range.rangeStartDate, range.rangeEndDate, ...filterPart.params];
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
  const range = utcRangeForCalendarDays(startCal, endCal, tz);

  const ppIds = await getPpIdsForProductFilter('subscription');
  const planPart = planFilterClause(ppIds);
  const filterPart = mergeSqlParts(planPart, gatewayFilterClause(paymentGateway));

  const daily = await queryDailyByKind(tz, range.rangeStartDate, range.rangeEndDate, filterPart, 'completed');
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
  total_purchases: 'purchasers.total_purchases',
  credit_balance: 'purchasers.credit_balance'
};

const PURCHASING_CUSTOMERS_RANGE_COLUMNS = {
  alacarte_purchases: 'alacarte_purchases',
  subscription_purchases: 'subscription_purchases',
  addon_purchases: 'addon_purchases',
  total_purchases: 'total_purchases',
  credit_balance: 'credit_balance'
};

/**
 * @param {string} [rangeField]
 * @param {number|null|undefined} rangeMin
 * @param {number|null|undefined} rangeMax
 * @returns {{ clause: string, params: number[] }}
 */
function buildPurchasingCustomersRangeClause(rangeField, rangeMin, rangeMax) {
  const key = rangeField != null ? String(rangeField).trim() : '';
  const col = PURCHASING_CUSTOMERS_RANGE_COLUMNS[key];
  if (!col) return { clause: '', params: [] };

  const parts = [];
  const params = [];
  if (rangeMin != null && Number.isFinite(Number(rangeMin))) {
    parts.push(`purchasers.${col} >= ?`);
    params.push(Math.floor(Number(rangeMin)));
  }
  if (rangeMax != null && Number.isFinite(Number(rangeMax))) {
    parts.push(`purchasers.${col} <= ?`);
    params.push(Math.floor(Number(rangeMax)));
  }
  if (!parts.length) return { clause: '', params: [] };
  return { clause: `AND ${parts.join(' AND ')}`, params };
}

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
  return `${col} ${dir}, purchasers.purchaser_key DESC`;
}

const PURCHASE_AT_ORDERS_SQL = `COALESCE(o.completed_at, o.created_at)`;
const PURCHASE_AT_ORDERS_ELIGIBLE_SQL = `COALESCE(completed_at, created_at)`;
/** When the purchase event was recorded — not billing-period `start_at` (RC can backdate). */
const PURCHASE_AT_SUBSCRIPTIONS_SQL = `s.created_at`;
const PURCHASE_AT_SUBSCRIPTIONS_ELIGIBLE_SQL = `created_at`;

/** Purchaser anchor — account user or unclaimed device (aligned with subscriptions analytics). */
const PURCHASER_TEXT_COLLATION = 'utf8mb4_unicode_ci';

/** orders.device_id vs subscriptions.device_id can differ in collation after additive migrations. */
function sqlCollateText(expr) {
  return `CONVERT(${expr} USING utf8mb4) COLLATE ${PURCHASER_TEXT_COLLATION}`;
}

function sqlPurchaserKey(userIdExpr, deviceIdExpr) {
  const deviceCol = sqlCollateText(deviceIdExpr);
  return `COALESCE(
    CONCAT('user:', CAST(${userIdExpr} AS CHAR) COLLATE ${PURCHASER_TEXT_COLLATION}),
    CONCAT('device:', ${deviceCol})
  )`;
}

const PURCHASER_KEY_ORDERS_ELIGIBLE = sqlPurchaserKey('user_id', 'device_id');
const PURCHASER_KEY_SUBSCRIPTIONS_ELIGIBLE = sqlPurchaserKey('s.user_id', 's.device_id');
const PURCHASER_KEY_O_ALIAS = sqlPurchaserKey('o.user_id', 'o.device_id');
const PURCHASER_KEY_S_ALIAS = sqlPurchaserKey('s.user_id', 's.device_id');
const DEVICE_ID_ORDERS_ELIGIBLE = sqlCollateText('device_id');
const DEVICE_ID_SUBSCRIPTIONS_ELIGIBLE = sqlCollateText('s.device_id');
const ORDER_PURCHASER_ANCHOR_FILTER = `(user_id IS NOT NULL OR device_id IS NOT NULL)`;
const ORDER_O_PURCHASER_ANCHOR_FILTER = `(o.user_id IS NOT NULL OR o.device_id IS NOT NULL)`;
const SUBSCRIPTION_S_PURCHASER_ANCHOR_FILTER = `(s.user_id IS NOT NULL OR s.device_id IS NOT NULL)`;

/** Order ↔ subscription link by user or guest device (±2 day window uses outer aliases). */
const ORDER_SUBSCRIPTION_LINK_MATCH_SQL = `
  (
    (o.user_id IS NOT NULL AND s_link.user_id = o.user_id)
    OR (
      o.user_id IS NULL
      AND o.device_id IS NOT NULL
      AND s_link.user_id IS NULL
      AND ${sqlCollateText('s_link.device_id')} = ${sqlCollateText('o.device_id')}
    )
  )
`;

/** Upgrade check for subscription rows linked to orders (`s_link` alias). */
const SUBSCRIPTION_IS_UPGRADE_FOR_LINK_SQL = `
  JSON_VALID(s_link.additional_data)
  AND JSON_UNQUOTE(JSON_EXTRACT(s_link.additional_data, '$.notes.type')) = 'upgrade'
`;

/** Upgrade check for duplicate-subscription comparison (`s_dup` alias). */
const SUBSCRIPTION_IS_UPGRADE_FOR_DUP_SQL = `
  JSON_VALID(s_dup.additional_data)
  AND JSON_UNQUOTE(JSON_EXTRACT(s_dup.additional_data, '$.notes.type')) = 'upgrade'
`;

/**
 * Completed order has a recurring initial/renewal subscription row within ±2 days
 * (same window as subscriptions analytics order link).
 */
const ORDER_LINKED_SUBSCRIPTION_ROW_EXISTS_SQL = `
  EXISTS (
    SELECT 1 FROM subscriptions s_link
    WHERE ${ORDER_SUBSCRIPTION_LINK_MATCH_SQL}
      AND s_link.payment_type = 'recurring'
      AND NOT (${SUBSCRIPTION_IS_UPGRADE_FOR_LINK_SQL})
      AND s_link.created_at >= DATE_SUB(${PURCHASE_AT_ORDERS_SQL}, INTERVAL 2 DAY)
      AND s_link.created_at <= DATE_ADD(${PURCHASE_AT_ORDERS_SQL}, INTERVAL 2 DAY)
  )
`;

/** Same purchaser for subscription row `s` vs duplicate candidate `s_dup`. */
const SUBSCRIPTION_S_S_DUP_PURCHASER_MATCH_SQL = `
  (
    (s.user_id IS NOT NULL AND s_dup.user_id = s.user_id)
    OR (
      s.user_id IS NULL
      AND s.device_id IS NOT NULL
      AND s_dup.user_id IS NULL
      AND ${sqlCollateText('s_dup.device_id')} = ${sqlCollateText('s.device_id')}
    )
  )
`;

/**
 * Secondary subscription row for the same checkout / webhook burst — do not double-count purchases.
 * 1) Cancelled row when a non-cancelled sibling exists within ±2 days (same purchaser).
 * 2) Near-duplicate active rows within 5 minutes — keep earliest `created_at` (tie-break subscription_id).
 */
const SUBSCRIPTION_IS_DUPLICATE_PURCHASE_EVENT_SQL = `
  (
    EXISTS (
      SELECT 1 FROM subscriptions s_dup
      WHERE ${SUBSCRIPTION_S_S_DUP_PURCHASER_MATCH_SQL}
        AND s_dup.subscription_id <> s.subscription_id
        AND s_dup.payment_type = 'recurring'
        AND NOT (${SUBSCRIPTION_IS_UPGRADE_FOR_DUP_SQL})
        AND ABS(TIMESTAMPDIFF(SECOND, s.created_at, s_dup.created_at)) <= 172800
        AND LOWER(TRIM(s.status)) = 'cancelled'
        AND LOWER(TRIM(s_dup.status)) NOT IN ('cancelled', 'expired')
    )
    OR EXISTS (
      SELECT 1 FROM subscriptions s_dup
      WHERE ${SUBSCRIPTION_S_S_DUP_PURCHASER_MATCH_SQL}
        AND s_dup.subscription_id <> s.subscription_id
        AND s_dup.payment_type = 'recurring'
        AND NOT (${SUBSCRIPTION_IS_UPGRADE_FOR_DUP_SQL})
        AND ABS(TIMESTAMPDIFF(SECOND, s.created_at, s_dup.created_at)) <= 300
        AND LOWER(TRIM(s.status)) NOT IN ('cancelled', 'expired')
        AND LOWER(TRIM(s_dup.status)) NOT IN ('cancelled', 'expired')
        AND (
          s_dup.created_at < s.created_at
          OR (
            s_dup.created_at = s.created_at
            AND s_dup.subscription_id < s.subscription_id
          )
        )
    )
  )
`;

/** Countable subscription purchase event (initial/renewal, not upgrade, not duplicate sibling). */
const SUBSCRIPTION_ORDER_LINK_MATCH_SQL = `
  (
    (s.user_id IS NOT NULL AND o_link.user_id = s.user_id)
    OR (
      s.user_id IS NULL
      AND s.device_id IS NOT NULL
      AND o_link.user_id IS NULL
      AND ${sqlCollateText('o_link.device_id')} = ${sqlCollateText('s.device_id')}
    )
  )
`;

/** Renewal subscription row (store/webhook renewal without a new checkout order). */
const SUBSCRIPTION_IS_RENEWAL_ROW_SQL = `
  JSON_VALID(s.additional_data)
  AND (
    (
      JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.previous_subscription_id')) IS NOT NULL
      AND JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.previous_subscription_id')) <> ''
      AND JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.previous_subscription_id')) <> 'null'
    )
    OR CAST(JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.renewal_count')) AS UNSIGNED) > 0
  )
`;

/** Parent subscription from \`previous_subscription_id\` is at least 1 day older (not same-checkout tagging). */
const SUBSCRIPTION_RENEWAL_PRIOR_SUB_OLD_ENOUGH_SQL = `
  EXISTS (
    SELECT 1 FROM subscriptions s_parent
    WHERE s_parent.subscription_id = JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.previous_subscription_id'))
      AND JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.previous_subscription_id')) IS NOT NULL
      AND JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.previous_subscription_id')) <> ''
      AND JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.previous_subscription_id')) <> 'null'
      AND s_parent.created_at <= DATE_SUB(s.created_at, INTERVAL 1 DAY)
  )
`;

/** Completed order tagged \`subscription_renewal\` within ±2 days of this subscription row. */
const SUBSCRIPTION_LINKED_RENEWAL_ORDER_EXISTS_SQL = `
  EXISTS (
    SELECT 1 FROM orders o_link
    LEFT JOIN payment_plans pp_link ON pp_link.pp_id = o_link.payment_plan_id
    WHERE o_link.status = 'completed'
      AND COALESCE(o_link.payment_gateway, '') <> 'admin_grant'
      AND ${SUBSCRIPTION_ORDER_LINK_MATCH_SQL}
      AND COALESCE(o_link.completed_at, o_link.created_at) >= DATE_SUB(${PURCHASE_AT_SUBSCRIPTIONS_SQL}, INTERVAL 2 DAY)
      AND COALESCE(o_link.completed_at, o_link.created_at) <= DATE_ADD(${PURCHASE_AT_SUBSCRIPTIONS_SQL}, INTERVAL 2 DAY)
      AND JSON_VALID(o_link.transaction_notes)
      AND LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(o_link.transaction_notes, '$.purchase_subject')))) = 'subscription_renewal'
      AND pp_link.pp_id IS NOT NULL
      AND pp_link.plan_type = 'credits'
      AND pp_link.billing_interval IN ('monthly', 'yearly')
  )
`;

const SUBSCRIPTION_S_S_OTHER_PURCHASER_MATCH_SQL = `
  (
    (s.user_id IS NOT NULL AND s_other.user_id = s.user_id)
    OR (
      s.user_id IS NULL
      AND s.device_id IS NOT NULL
      AND s_other.user_id IS NULL
      AND ${sqlCollateText('s_other.device_id')} = ${sqlCollateText('s.device_id')}
    )
  )
`;

/** Shared completed subscription/renewal order — same purchaser, ±2d from \`s.created_at\`. */
const SUBSCRIPTION_ORDER_LINK_FOR_ROW_SQL = `
  o_shared.status = 'completed'
  AND COALESCE(o_shared.payment_gateway, '') <> 'admin_grant'
  AND (
    (s.user_id IS NOT NULL AND o_shared.user_id = s.user_id)
    OR (
      s.user_id IS NULL
      AND s.device_id IS NOT NULL
      AND o_shared.user_id IS NULL
      AND ${sqlCollateText('o_shared.device_id')} = ${sqlCollateText('s.device_id')}
    )
  )
  AND COALESCE(o_shared.completed_at, o_shared.created_at) >= DATE_SUB(${PURCHASE_AT_SUBSCRIPTIONS_SQL}, INTERVAL 2 DAY)
  AND COALESCE(o_shared.completed_at, o_shared.created_at) <= DATE_ADD(${PURCHASE_AT_SUBSCRIPTIONS_SQL}, INTERVAL 2 DAY)
  AND (
    (
      pp_shared.pp_id IS NOT NULL
      AND pp_shared.plan_type = 'credits'
      AND pp_shared.billing_interval IN ('monthly', 'yearly')
    )
    OR (
      JSON_VALID(o_shared.transaction_notes)
      AND LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(o_shared.transaction_notes, '$.purchase_subject')))) = 'subscription_renewal'
      AND pp_shared.pp_id IS NOT NULL
      AND pp_shared.plan_type = 'credits'
      AND pp_shared.billing_interval IN ('monthly', 'yearly')
    )
  )
`;

/**
 * When multiple subscription rows link to the same completed order, count only the row
 * whose `created_at` is closest to that order (avoids stale rows + new renewal both counting).
 *
 * Shadow is evaluated only on **this row's nearest** linked order. Otherwise back-to-back
 * renewals (orders 7 & 8) both get excluded: each row loses on the other order's ±2d window.
 */
const SUBSCRIPTION_IS_SHADOWED_BY_CLOSER_ORDER_LINK_SQL = `
  EXISTS (
    SELECT 1 FROM orders o_shared
    LEFT JOIN payment_plans pp_shared ON pp_shared.pp_id = o_shared.payment_plan_id
    INNER JOIN subscriptions s_closer ON s_closer.subscription_id <> s.subscription_id
      AND s_closer.payment_type = 'recurring'
      AND NOT (
        JSON_VALID(s_closer.additional_data)
        AND JSON_UNQUOTE(JSON_EXTRACT(s_closer.additional_data, '$.notes.type')) = 'upgrade'
      )
      AND ${SUBSCRIPTION_S_S_OTHER_PURCHASER_MATCH_SQL.replace(/s_other/g, 's_closer')}
      AND COALESCE(o_shared.completed_at, o_shared.created_at) >= DATE_SUB(s_closer.created_at, INTERVAL 2 DAY)
      AND COALESCE(o_shared.completed_at, o_shared.created_at) <= DATE_ADD(s_closer.created_at, INTERVAL 2 DAY)
      AND ABS(TIMESTAMPDIFF(SECOND, s_closer.created_at, COALESCE(o_shared.completed_at, o_shared.created_at)))
          < ABS(TIMESTAMPDIFF(SECOND, s.created_at, COALESCE(o_shared.completed_at, o_shared.created_at)))
    WHERE ${SUBSCRIPTION_ORDER_LINK_FOR_ROW_SQL}
      AND NOT EXISTS (
        SELECT 1 FROM orders o_nearest
        LEFT JOIN payment_plans pp_nearest ON pp_nearest.pp_id = o_nearest.payment_plan_id
        WHERE o_nearest.status = 'completed'
          AND COALESCE(o_nearest.payment_gateway, '') <> 'admin_grant'
          AND (
            (s.user_id IS NOT NULL AND o_nearest.user_id = s.user_id)
            OR (
              s.user_id IS NULL
              AND s.device_id IS NOT NULL
              AND o_nearest.user_id IS NULL
              AND ${sqlCollateText('o_nearest.device_id')} = ${sqlCollateText('s.device_id')}
            )
          )
          AND COALESCE(o_nearest.completed_at, o_nearest.created_at) >= DATE_SUB(${PURCHASE_AT_SUBSCRIPTIONS_SQL}, INTERVAL 2 DAY)
          AND COALESCE(o_nearest.completed_at, o_nearest.created_at) <= DATE_ADD(${PURCHASE_AT_SUBSCRIPTIONS_SQL}, INTERVAL 2 DAY)
          AND (
            (
              pp_nearest.pp_id IS NOT NULL
              AND pp_nearest.plan_type = 'credits'
              AND pp_nearest.billing_interval IN ('monthly', 'yearly')
            )
            OR (
              JSON_VALID(o_nearest.transaction_notes)
              AND LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(o_nearest.transaction_notes, '$.purchase_subject')))) = 'subscription_renewal'
              AND pp_nearest.pp_id IS NOT NULL
              AND pp_nearest.plan_type = 'credits'
              AND pp_nearest.billing_interval IN ('monthly', 'yearly')
            )
          )
          AND ABS(TIMESTAMPDIFF(SECOND, s.created_at, COALESCE(o_nearest.completed_at, o_nearest.created_at)))
              < ABS(TIMESTAMPDIFF(SECOND, s.created_at, COALESCE(o_shared.completed_at, o_shared.created_at)))
      )
  )
`;

/** Store/webhook renewal that should count as a purchase (not same-day resubscribe sibling tagging). */
const SUBSCRIPTION_IS_RENEWAL_PURCHASE_EVENT_SQL = `
  (${SUBSCRIPTION_IS_RENEWAL_ROW_SQL})
  AND (
    (${SUBSCRIPTION_LINKED_RENEWAL_ORDER_EXISTS_SQL})
    OR (${SUBSCRIPTION_RENEWAL_PRIOR_SUB_OLD_ENOUGH_SQL})
  )
`;

/**
 * Initial subscription checkout: count the subscription row only when a completed
 * subscription-plan order exists within ±2 days (mirrors order-side dedup).
 * Orphan rows after manual order deletes must not inflate purchase counts.
 */
const SUBSCRIPTION_LINKED_COMPLETED_ORDER_EXISTS_SQL = `
  EXISTS (
    SELECT 1 FROM orders o_link
    LEFT JOIN payment_plans pp_link ON pp_link.pp_id = o_link.payment_plan_id
    WHERE o_link.status = 'completed'
      AND COALESCE(o_link.payment_gateway, '') <> 'admin_grant'
      AND ${SUBSCRIPTION_ORDER_LINK_MATCH_SQL}
      AND COALESCE(o_link.completed_at, o_link.created_at) >= DATE_SUB(${PURCHASE_AT_SUBSCRIPTIONS_SQL}, INTERVAL 2 DAY)
      AND COALESCE(o_link.completed_at, o_link.created_at) <= DATE_ADD(${PURCHASE_AT_SUBSCRIPTIONS_SQL}, INTERVAL 2 DAY)
      AND (
        (
          pp_link.pp_id IS NOT NULL
          AND pp_link.plan_type = 'credits'
          AND pp_link.billing_interval IN ('monthly', 'yearly')
        )
        OR (
          JSON_VALID(o_link.transaction_notes)
          AND LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(o_link.transaction_notes, '$.purchase_subject')))) = 'subscription_renewal'
          AND pp_link.pp_id IS NOT NULL
          AND pp_link.plan_type = 'credits'
          AND pp_link.billing_interval IN ('monthly', 'yearly')
        )
      )
  )
`;

const SUBSCRIPTION_COUNTS_AS_PURCHASE_EVENT_SQL = `
  ${SUBSCRIPTION_IS_INITIAL_OR_RENEWAL_SQL}
  AND NOT (${SUBSCRIPTION_IS_DUPLICATE_PURCHASE_EVENT_SQL})
  AND NOT (${SUBSCRIPTION_IS_SHADOWED_BY_CLOSER_ORDER_LINK_SQL})
  AND (
    (${SUBSCRIPTION_IS_RENEWAL_PURCHASE_EVENT_SQL})
    OR (${SUBSCRIPTION_LINKED_COMPLETED_ORDER_EXISTS_SQL})
  )
`;

/** Completed order explicitly tagged renewal ledger (`transaction_notes`), recurring credits plan — may lack linked sub ±2d. */
const ORDER_IS_RENEWAL_LEDGER_SQL = `
  (${ORDER_NOTE_IS_SUBSCRIPTION_RENEWAL_SQL})
  AND (${ORDER_IS_SUBSCRIPTION_PLAN_SQL})
`;

/**
 * @param {{ rangeStartDate: Date, rangeEndDate: Date }} range
 * @returns {Date[]}
 */
function purchasingCustomersDateParams(range) {
  return mysqlUtcRangeParams(range);
}

/**
 * Paginated customers who have at least one purchase in the calendar date range
 * (completed order and/or initial/renewal subscription row).
 *
 * Purchase counts are computed in SQL (not summed on the client):
 * - `alacarte_purchases`: completed orders on à la carte plans
 * - `addon_purchases`: completed orders on add-on plans and one-time credit packs
 * - `subscription_purchases`: initial + renewal subscription rows, plus completed recurring
 *   subscription-plan orders not already represented by a linked subscription row (±2 days)
 * - `total_purchases`: `alacarte + addon + subscription` (all from SQL)
 *
 * @param {Object} opts
 * @param {string} opts.startCal YYYY-MM-DD
 * @param {string} opts.endCal YYYY-MM-DD
 * @param {string} opts.tz IANA timezone for calendar-day bounds
 * @param {string} [opts.search] name, email, mobile, or user id fragment
 * @param {number} opts.limit
 * @param {number} opts.offset
 * @param {string} [opts.sortBy]
 * @param {string} [opts.sortDir] asc | desc
 * @param {string} [opts.rangeField] alacarte_purchases | subscription_purchases | addon_purchases | total_purchases | credit_balance
 * @param {number} [opts.rangeMin]
 * @param {number} [opts.rangeMax]
 * @param {boolean} [opts.useMaster]
 * @returns {Promise<{ rows: object[], total: number }>}
 */
exports.listPurchasingCustomersForAdmin = async function (opts) {
  const {
    startCal,
    endCal,
    tz,
    search = '',
    limit,
    offset,
    sortBy,
    sortDir,
    rangeField,
    rangeMin,
    rangeMax,
    useMaster = false
  } = opts;
  const orderBySql = resolvePurchasingCustomersOrderBy(sortBy, sortDir);
  const runQuery = useMaster ? MysqlQueryRunner.runQueryInMaster : MysqlQueryRunner.runQueryInSlave;
  const range = utcRangeForCalendarDays(startCal, endCal, tz);
  const datePair = purchasingCustomersDateParams(range);

  const searchTrim = search != null ? String(search).trim() : '';
  let searchClause = '';
  const searchParams = [];
  if (searchTrim) {
    const term = `%${searchTrim}%`;
    searchClause = `
      AND (
        CAST(eligible.user_id AS CHAR) LIKE ?
        OR COALESCE(eligible.device_id, '') LIKE ?
        OR COALESCE(u.display_name, '') LIKE ?
        OR COALESCE(u.email, '') LIKE ?
        OR COALESCE(u.mobile, '') LIKE ?
        OR TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) LIKE ?
      )
    `;
    searchParams.push(term, term, term, term, term, term);
  }

  const baseFromParams = [
    ...datePair,
    ...datePair,
    ...datePair,
    ...datePair,
    ...searchParams
  ];

  const baseFrom = `
    FROM (
      SELECT
        purchaser_key,
        MAX(user_id) AS user_id,
        CASE
          WHEN MAX(user_id) IS NOT NULL THEN NULL
          ELSE MAX(device_id)
        END AS device_id
      FROM (
        SELECT DISTINCT
          ${PURCHASER_KEY_ORDERS_ELIGIBLE} AS purchaser_key,
          user_id,
          ${DEVICE_ID_ORDERS_ELIGIBLE} AS device_id
        FROM orders
        WHERE status = 'completed' AND COALESCE(payment_gateway, '') <> 'admin_grant'
          AND ${ORDER_PURCHASER_ANCHOR_FILTER}
          AND ${PURCHASE_AT_ORDERS_ELIGIBLE_SQL} >= ? AND ${PURCHASE_AT_ORDERS_ELIGIBLE_SQL} <= ?
        UNION
        SELECT DISTINCT
          ${PURCHASER_KEY_SUBSCRIPTIONS_ELIGIBLE} AS purchaser_key,
          s.user_id,
          ${DEVICE_ID_SUBSCRIPTIONS_ELIGIBLE} AS device_id
        FROM subscriptions s
        WHERE ${SUBSCRIPTION_IS_INITIAL_OR_RENEWAL_SQL}
          AND ${SUBSCRIPTION_S_PURCHASER_ANCHOR_FILTER}
          AND ${PURCHASE_AT_SUBSCRIPTIONS_ELIGIBLE_SQL} >= ? AND ${PURCHASE_AT_SUBSCRIPTIONS_ELIGIBLE_SQL} <= ?
      ) eligible_raw
      GROUP BY purchaser_key
    ) eligible
    LEFT JOIN user u ON u.user_id = eligible.user_id AND (u.DELETED_AT IS NULL)
    LEFT JOIN (
      SELECT
        ${PURCHASER_KEY_O_ALIAS} AS purchaser_key,
        SUM(CASE WHEN ${ORDER_IS_ALACARTE_SQL} THEN 1 ELSE 0 END) AS alacarte_purchases,
        SUM(
          CASE
            WHEN ${ORDER_IS_ADDON_SQL} OR ${ORDER_IS_ONETIME_CREDITS_SQL} THEN 1
            ELSE 0
          END
        ) AS addon_purchases,
        SUM(
          CASE
            WHEN ${ORDER_IS_RENEWAL_LEDGER_SQL} AND NOT (${ORDER_LINKED_SUBSCRIPTION_ROW_EXISTS_SQL}) THEN 1
            WHEN ${ORDER_IS_SUBSCRIPTION_PLAN_SQL} AND NOT (${ORDER_LINKED_SUBSCRIPTION_ROW_EXISTS_SQL}) THEN 1
            WHEN pp.pp_id IS NULL AND NOT (${ORDER_LINKED_SUBSCRIPTION_ROW_EXISTS_SQL}) THEN 1
            ELSE 0
          END
        ) AS subscription_order_purchases,
        MAX(${PURCHASE_AT_ORDERS_SQL}) AS last_order_at
      FROM orders o
      LEFT JOIN payment_plans pp ON pp.pp_id = o.payment_plan_id
      WHERE o.status = 'completed' AND COALESCE(o.payment_gateway, '') <> 'admin_grant'
        AND ${ORDER_O_PURCHASER_ANCHOR_FILTER}
        AND ${PURCHASE_AT_ORDERS_SQL} >= ? AND ${PURCHASE_AT_ORDERS_SQL} <= ?
      GROUP BY purchaser_key
    ) ostats ON ostats.purchaser_key = eligible.purchaser_key
    LEFT JOIN (
      SELECT
        ${PURCHASER_KEY_S_ALIAS} AS purchaser_key,
        COUNT(*) AS subscription_purchases,
        MAX(${PURCHASE_AT_SUBSCRIPTIONS_SQL}) AS last_subscription_at
      FROM subscriptions s
      WHERE ${SUBSCRIPTION_COUNTS_AS_PURCHASE_EVENT_SQL}
        AND ${SUBSCRIPTION_S_PURCHASER_ANCHOR_FILTER}
        AND ${PURCHASE_AT_SUBSCRIPTIONS_SQL} >= ? AND ${PURCHASE_AT_SUBSCRIPTIONS_SQL} <= ?
      GROUP BY purchaser_key
    ) sstats ON sstats.purchaser_key = eligible.purchaser_key
    LEFT JOIN user_credits uc ON (
      (eligible.user_id IS NOT NULL AND uc.user_id = eligible.user_id)
      OR (
        eligible.user_id IS NULL
        AND eligible.device_id IS NOT NULL
        AND ${sqlCollateText('uc.device_id')} = eligible.device_id
        AND uc.user_id IS NULL
      )
    )
    WHERE 1=1
    ${searchClause}
  `;

  const aggSelect = `
    SELECT
      eligible.purchaser_key,
      eligible.user_id,
      eligible.device_id,
      CASE
        WHEN eligible.user_id IS NOT NULL THEN COALESCE(
          NULLIF(TRIM(u.display_name), ''),
          NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''),
          NULLIF(TRIM(u.email), ''),
          CAST(eligible.user_id AS CHAR)
        )
        WHEN eligible.device_id IS NOT NULL THEN CONCAT(
          'Guest device',
          IF(CHAR_LENGTH(eligible.device_id) > 8, CONCAT(' · ', RIGHT(eligible.device_id, 8)), '')
        )
        ELSE CAST(eligible.purchaser_key AS CHAR)
      END AS user_name,
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
      ) AS last_purchased_at,
      COALESCE(uc.balance, 0) AS credit_balance,
      COALESCE(uc.reserved_balance, 0) AS credit_reserved_balance
    ${baseFrom}
  `;

  const { clause: rangeClause, params: rangeParams } = buildPurchasingCustomersRangeClause(
    rangeField,
    rangeMin,
    rangeMax
  );

  const countQuery = `
    SELECT COUNT(*) AS cnt
    FROM (
      ${aggSelect}
    ) purchasers
    WHERE purchasers.total_purchases > 0
    ${rangeClause}
  `;
  const countRows = await runQuery(countQuery, [...baseFromParams, ...rangeParams]);
  const total = Number(countRows[0]?.cnt || 0) || 0;

  const summaryQuery = `
    SELECT
      COALESCE(SUM(purchasers.alacarte_purchases), 0) AS alacarte_purchases,
      COALESCE(SUM(purchasers.addon_purchases), 0) AS addon_purchases,
      COALESCE(SUM(purchasers.subscription_purchases), 0) AS subscription_purchases,
      COALESCE(SUM(purchasers.total_purchases), 0) AS total_purchases
    FROM (
      ${aggSelect}
    ) purchasers
    WHERE purchasers.total_purchases > 0
    ${rangeClause}
  `;
  const summaryRows = await runQuery(summaryQuery, [...baseFromParams, ...rangeParams]);
  const summaryRow = summaryRows[0] || {};
  const summary = {
    alacarte_purchases: Number(summaryRow.alacarte_purchases) || 0,
    addon_purchases: Number(summaryRow.addon_purchases) || 0,
    subscription_purchases: Number(summaryRow.subscription_purchases) || 0,
    total_purchases: Number(summaryRow.total_purchases) || 0
  };

  const listQuery = `
    SELECT * FROM (
      ${aggSelect}
    ) purchasers
    WHERE purchasers.total_purchases > 0
    ${rangeClause}
    ORDER BY ${orderBySql}
    LIMIT ? OFFSET ?
  `;
  const rows = await runQuery(listQuery, [...baseFromParams, ...rangeParams, limit, offset]);
  return { rows: rows || [], total, summary };
};

/** Completed order rows that count as a deduped purchase event (matches purchasing-customers SQL). */
const DEDUPED_PURCHASE_ORDER_EVENT_FILTER_SQL = `
  (
    (${ORDER_IS_ALACARTE_SQL})
    OR (${ORDER_IS_ADDON_SQL})
    OR (${ORDER_IS_ONETIME_CREDITS_SQL})
    OR (
      (
        (${ORDER_IS_RENEWAL_LEDGER_SQL})
        OR (${ORDER_IS_SUBSCRIPTION_PLAN_SQL})
        OR pp.pp_id IS NULL
      )
      AND NOT (${ORDER_LINKED_SUBSCRIPTION_ROW_EXISTS_SQL})
    )
  )
`;

/**
 * Deduped purchase events per calendar day (MySQL source of truth — matches Customers → Purchases).
 *
 * @param {{ startCal: string, endCal: string, tz: string }} opts
 * @returns {Promise<Array<{ date: string, count: number }>>}
 */
exports.getDedupedPurchaseEventsDaily = async function (opts) {
  const { startCal, endCal, tz } = opts || {};
  const range = utcRangeForCalendarDays(startCal, endCal, tz);

  const orderEventsQuery = `
    SELECT DATE_FORMAT(${PURCHASE_AT_ORDERS_SQL}, '%Y-%m-%d %H:%i:%s') AS ts_utc
    FROM orders o
    LEFT JOIN payment_plans pp ON pp.pp_id = o.payment_plan_id
    WHERE o.status = 'completed' AND COALESCE(o.payment_gateway, '') <> 'admin_grant'
      AND ${ORDER_O_PURCHASER_ANCHOR_FILTER}
      AND ${PURCHASE_AT_ORDERS_SQL} >= ? AND ${PURCHASE_AT_ORDERS_SQL} <= ?
      AND ${DEDUPED_PURCHASE_ORDER_EVENT_FILTER_SQL}
  `;

  const subscriptionEventsQuery = `
    SELECT DATE_FORMAT(${PURCHASE_AT_SUBSCRIPTIONS_SQL}, '%Y-%m-%d %H:%i:%s') AS ts_utc
    FROM subscriptions s
    WHERE ${SUBSCRIPTION_COUNTS_AS_PURCHASE_EVENT_SQL}
      AND ${SUBSCRIPTION_S_PURCHASER_ANCHOR_FILTER}
      AND ${PURCHASE_AT_SUBSCRIPTIONS_SQL} >= ? AND ${PURCHASE_AT_SUBSCRIPTIONS_SQL} <= ?
  `;

  const params = mysqlUtcRangeParams(range);
  const [orderRows, subscriptionRows] = await Promise.all([
    MysqlQueryRunner.runQueryInSlave(orderEventsQuery, params),
    MysqlQueryRunner.runQueryInSlave(subscriptionEventsQuery, params)
  ]);

  const dayCounts = new Map();
  for (const r of [...(orderRows || []), ...(subscriptionRows || [])]) {
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
};

/**
 * Total deduped purchase count for a calendar range (sum of per-customer purchase events).
 *
 * @param {{ startCal: string, endCal: string, tz: string }} opts
 * @returns {Promise<{ total_purchases: number, alacarte_purchases: number, subscription_purchases: number, addon_purchases: number }>}
 */
exports.getDedupedPurchaseEventsSummary = async function (opts) {
  const { summary } = await exports.listPurchasingCustomersForAdmin({
    ...opts,
    search: '',
    limit: 1,
    offset: 0,
    useMaster: false
  });
  return summary;
};

/** Extract template_id from orders.transaction_notes (à la carte single-template purchases). */
const ORDER_TEMPLATE_ID_EXPR = `
  COALESCE(
    NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(o.transaction_notes, '$.template_id'))), ''),
    NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(o.transaction_notes, '$.template_resource_id'))), '')
  )
`;

/**
 * Per-template order_created / order_completed counts from MySQL (source of truth).
 * Matches admin Top Templates by Generation — uses transaction_notes.template_id, not ClickHouse hub events.
 *
 * @param {{ rangeStartUtc: string, rangeEndUtc: string, templateIds: string[] }} opts
 * @returns {Promise<Array<{ template_id: string, orders_created: number, orders_completed: number }>>}
 */
exports.getOrderCountsByTemplateIds = async function (opts) {
  const { rangeStartUtc, rangeEndUtc, templateIds } = opts || {};
  const ids = [...new Set((templateIds || []).map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length || !rangeStartUtc || !rangeEndUtc) return [];

  const rangeStartDate = rangeStartUtc instanceof Date
    ? rangeStartUtc
    : moment.utc(String(rangeStartUtc), 'YYYY-MM-DD HH:mm:ss.SSS', true).toDate();
  const rangeEndDate = rangeEndUtc instanceof Date
    ? rangeEndUtc
    : moment.utc(String(rangeEndUtc), 'YYYY-MM-DD HH:mm:ss.SSS', true).toDate();

  const query = `
    SELECT
      ${ORDER_TEMPLATE_ID_EXPR} AS template_id,
      SUM(CASE WHEN o.created_at >= ? AND o.created_at <= ? THEN 1 ELSE 0 END) AS orders_created,
      SUM(CASE
        WHEN o.status = 'completed'
          AND COALESCE(o.completed_at, o.created_at) >= ?
          AND COALESCE(o.completed_at, o.created_at) <= ?
        THEN 1 ELSE 0
      END) AS orders_completed
    FROM orders o
    WHERE COALESCE(o.payment_gateway, '') <> 'admin_grant'
      AND ${ORDER_TEMPLATE_ID_EXPR} IN (?)
      AND (
        (o.created_at >= ? AND o.created_at <= ?)
        OR (
          o.status = 'completed'
          AND COALESCE(o.completed_at, o.created_at) >= ?
          AND COALESCE(o.completed_at, o.created_at) <= ?
        )
      )
    GROUP BY template_id
  `;
  const params = [
    rangeStartDate,
    rangeEndDate,
    rangeStartDate,
    rangeEndDate,
    ids,
    rangeStartDate,
    rangeEndDate,
    rangeStartDate,
    rangeEndDate
  ];
  const rows = await MysqlQueryRunner.runQueryInSlave(query, params);
  return (rows || []).filter((r) => r.template_id);
};

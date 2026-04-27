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
 * Daily buckets: filter in SQL (UTC range), aggregate by calendar day in `tz` in Node.
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
    dateFormatCol = "DATE_FORMAT(o.completed_at, '%Y-%m-%d %H:%i:%s')";
    whereExtra = `o.status = 'completed' AND o.completed_at IS NOT NULL AND o.completed_at >= ? AND o.completed_at <= ?`;
  } else {
    dateFormatCol = "DATE_FORMAT(o.failed_at, '%Y-%m-%d %H:%i:%s')";
    whereExtra = `o.status = 'failed' AND o.failed_at IS NOT NULL AND o.failed_at >= ? AND o.failed_at <= ?`;
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
 * @param {string} rangeStartUtc
 * @param {string} rangeEndUtc
 * @param {{ sql: string, params: any[] }} filterPart
 * @param {'created'|'completed'|'failed'} kind
 */
async function queryCountByKind(rangeStartUtc, rangeEndUtc, filterPart, kind) {
  let whereExtra;
  if (kind === 'created') {
    whereExtra = 'o.created_at >= ? AND o.created_at <= ?';
  } else if (kind === 'completed') {
    whereExtra = `o.status = 'completed' AND o.completed_at IS NOT NULL AND o.completed_at >= ? AND o.completed_at <= ?`;
  } else {
    whereExtra = `o.status = 'failed' AND o.failed_at IS NOT NULL AND o.failed_at >= ? AND o.failed_at <= ?`;
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
 * Summary counts for metric cards (same date semantics and product filter as daily series).
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

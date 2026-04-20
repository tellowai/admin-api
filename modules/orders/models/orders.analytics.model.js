'use strict';

const MysqlQueryRunner = require('../../core/models/mysql.promise.model');
const moment = require('moment-timezone');

/**
 * CONVERT_TZ(..., 'Region/Name') requires MySQL time_zone tables; many dev DBs lack them → NULL.
 * Offset-based CONVERT_TZ works without those tables. India has no DST.
 * @param {string} tz IANA (e.g. Asia/Kolkata)
 * @returns {string} MySQL `to_timezone` argument
 */
function mysqlConvertTzTarget(tz) {
  const t = String(tz || '').trim();
  if (t === 'Asia/Kolkata' || t === 'Asia/Calcutta') {
    return '+05:30';
  }
  return t;
}

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

/**
 * Format a MySQL date / Date / string as YYYY-MM-DD for API consumers.
 * Converting a JS Date with moment.utc() alone is wrong for DATE that represents a
 * day in a non-UTC zone: mysql2 often gives e.g. 2026-03-31T18:30:00.000Z for "2026-04-01" in IST
 * (midnight local). Use the same IANA `tz` as the chart / CONVERT_TZ calendar semantics.
 * @param {*} v
 * @param {string} [displayTz] IANA e.g. Asia/Kolkata
 * @returns {string}
 */
function rowDayToIso(v, displayTz) {
  if (v == null) return '';
  if (v instanceof Date) {
    const z = String(displayTz || '').trim();
    if (z && z !== 'UTC' && z !== 'Etc/UTC' && z !== 'GMT') {
      return moment.tz(v, z).format('YYYY-MM-DD');
    }
    return moment.utc(v).format('YYYY-MM-DD');
  }
  return String(v).split('T')[0];
}

/**
 * Daily buckets via derived table — compatible with sql_mode=ONLY_FULL_GROUP_BY (single grouped expression).
 * @param {string} tz
 * @param {string} rangeStartUtc
 * @param {string} rangeEndUtc
 * @param {{ sql: string, params: any[] }} planPart
 * @param {'created'|'completed'|'failed'} kind
 */
async function queryDailyByKind(tz, rangeStartUtc, rangeEndUtc, planPart, kind) {
  const tzSql = mysqlConvertTzTarget(tz);
  let innerDateExpr;
  let whereExtra;
  // Use offset (+05:30) for India so CONVERT_TZ works without mysql.time_zone_* tables; keep COALESCE to UTC DATE as safety net.
  if (kind === 'created') {
    innerDateExpr = `COALESCE(
      DATE(CONVERT_TZ(o.created_at, '+00:00', ?)),
      DATE(o.created_at)
    )`;
    whereExtra = 'o.created_at >= ? AND o.created_at <= ?';
  } else if (kind === 'completed') {
    innerDateExpr = `COALESCE(
      DATE(CONVERT_TZ(o.completed_at, '+00:00', ?)),
      DATE(o.completed_at)
    )`;
    whereExtra = `o.status = 'completed' AND o.completed_at IS NOT NULL AND o.completed_at >= ? AND o.completed_at <= ?`;
  } else {
    innerDateExpr = `COALESCE(
      DATE(CONVERT_TZ(o.failed_at, '+00:00', ?)),
      DATE(o.failed_at)
    )`;
    whereExtra = `o.status = 'failed' AND o.failed_at IS NOT NULL AND o.failed_at >= ? AND o.failed_at <= ?`;
  }

  const query = `
    SELECT t.stat_date, COUNT(*) AS count
    FROM (
      SELECT ${innerDateExpr} AS stat_date
      FROM orders o
      WHERE ${whereExtra}
      ${planPart.sql}
    ) t
    WHERE t.stat_date IS NOT NULL
    GROUP BY t.stat_date
    ORDER BY t.stat_date ASC
  `;

  const params = [tzSql, rangeStartUtc, rangeEndUtc, ...planPart.params];
  const rows = await MysqlQueryRunner.runQueryInSlave(query, params);
  return (rows || []).map((r) => ({
    date: rowDayToIso(r.stat_date, tz),
    count: Number(r.count) || 0
  }));
}

/**
 * @param {string} rangeStartUtc
 * @param {string} rangeEndUtc
 * @param {{ sql: string, params: any[] }} planPart
 * @param {'created'|'completed'|'failed'} kind
 */
async function queryCountByKind(rangeStartUtc, rangeEndUtc, planPart, kind) {
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
    ${planPart.sql}
  `;

  const params = [rangeStartUtc, rangeEndUtc, ...planPart.params];
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
 */
exports.getOrdersStatusDaily = async function (opts) {
  const { startCal, endCal, tz, productType } = opts;

  const { rangeStartUtc, rangeEndUtc } = utcRangeForCalendarDays(startCal, endCal, tz);

  let ppIds = null;
  if (productType && String(productType).trim()) {
    ppIds = await getPpIdsForProductFilter(String(productType).trim());
  }
  const planPart = planFilterClause(ppIds);

  const [created, completed] = await Promise.all([
    queryDailyByKind(tz, rangeStartUtc, rangeEndUtc, planPart, 'created'),
    queryDailyByKind(tz, rangeStartUtc, rangeEndUtc, planPart, 'completed')
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
 */
exports.getOrdersStatusSummary = async function (opts) {
  const { startCal, endCal, tz, productType } = opts;
  const { rangeStartUtc, rangeEndUtc } = utcRangeForCalendarDays(startCal, endCal, tz);

  let ppIds = null;
  if (productType && String(productType).trim()) {
    ppIds = await getPpIdsForProductFilter(String(productType).trim());
  }
  const planPart = planFilterClause(ppIds);

  const [created_count, completed_count, failed_count] = await Promise.all([
    queryCountByKind(rangeStartUtc, rangeEndUtc, planPart, 'created'),
    queryCountByKind(rangeStartUtc, rangeEndUtc, planPart, 'completed'),
    queryCountByKind(rangeStartUtc, rangeEndUtc, planPart, 'failed')
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

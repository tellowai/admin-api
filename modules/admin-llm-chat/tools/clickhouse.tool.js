'use strict';

const {
  readonlyClickhouse,
  isClickHouseReadonlyConfigured,
  pingClickHouseReadonly,
  CH_NOT_CONFIGURED_MSG,
} = require('../../../config/lib/clickhouse.readonly');
const { validateClickHouseSql } = require('./clickhouse.sql.validator');
const WHITELIST = require('../constants/clickhouse.whitelist');
const CONSTANTS = require('../constants/admin-llm-chat.constants');
const { SCHEMA_VERSION } = require('../services/schema.cache.service');
const { redactRows } = require('../services/pii.redactor');

function chUnavailableResult(message, retryable = true) {
  return {
    success: false,
    error: 'CH_UNAVAILABLE',
    message: message || CH_NOT_CONFIGURED_MSG,
    retryable,
  };
}

async function queryClickhouse({ sql, max_rows: maxRows }) {
  if (!isClickHouseReadonlyConfigured() || !readonlyClickhouse) {
    return chUnavailableResult(CH_NOT_CONFIGURED_MSG);
  }

  const validation = validateClickHouseSql(sql);
  if (!validation.ok) {
    return {
      success: false,
      error: validation.code,
      message: validation.message,
      hint: validation.hint
        || (validation.code === 'INVALID_DATE_COLUMN'
          ? 'Call get_table_schema for this table and use required_date_column in WHERE.'
          : validation.code === 'DATE_PREDICATE_REQUIRED'
            ? 'Call get_table_date_bounds or get_date_context; never query min/max(date) without WHERE.'
            : undefined),
    };
  }

  let runSql = validation.sql;
  if (maxRows && maxRows > 0 && maxRows <= CONSTANTS.CH_QUERY_LIMIT_MAX) {
    runSql = runSql.replace(/\bLIMIT\s+\d+/i, `LIMIT ${maxRows}`);
  }

  const start = Date.now();
  try {
    const { data } = await readonlyClickhouse.querying(runSql, { dataObjects: true });
    const rows = Array.isArray(data) ? data : [];
    const redacted = redactRows(rows);
    const truncated = rows.length >= (maxRows || CONSTANTS.CH_QUERY_LIMIT_DEFAULT);
    return enrichMonetaryResult({
      success: true,
      rows: redacted,
      row_count: redacted.length,
      truncated,
      query_ms: Date.now() - start,
    }, runSql, validation.tables);
  } catch (error) {
    const msg = String(error.message || '');
    if (msg.includes('Timeout')) {
      return { success: false, error: 'QUERY_TIMEOUT', message: error.message };
    }
    const missingDate = msg.match(/Missing columns:\s*'date'/i);
    if (missingDate) {
      const table = (runSql.match(/\bFROM\s+(?:`?\w+`?\.)?`?(\w+)`?/i) || [])[1];
      const meta = table && WHITELIST[table];
      const col = meta?.required_date_column || 'report_date';
      return {
        success: false,
        error: 'INVALID_DATE_COLUMN',
        message: `Table ${table || 'unknown'} has no column "date". Use "${col}" in WHERE.`,
        hint: 'Call get_table_schema before query_clickhouse.',
        retryable: true,
      };
    }
    if (msg.includes('ILLEGAL_TYPE_OF_ARGUMENT') && /AggregateFunction\(/i.test(msg)) {
      const colMatch = msg.match(/AggregateFunction\((\w+),/i);
      const fn = colMatch?.[1];
      return {
        success: false,
        error: 'AGGREGATE_STATE_MISMATCH',
        message: `Column has type AggregateFunction(${fn || '?'}, ...) — call ${fn || 'uniq'}Merge(<column>) instead of sum()/count()/uniq().`,
        hint: 'Call get_table_schema first and use aggregate_state_columns to pick the right *Merge function (e.g. uniqMerge(unique_users)).',
        retryable: true,
      };
    }
    if (msg.includes('ILLEGAL_AGGREGATION')) {
      return {
        success: false,
        error: 'ILLEGAL_AGGREGATION',
        message: 'Aggregate alias shadows a column (e.g. sum(spend) AS spend with HAVING spend > 0). Use agg_* aliases or HAVING sum(spend) > 0.',
        hint: 'Do not alias sum(spend) AS spend; use AS agg_spend and HAVING agg_spend > 0, or HAVING sum(spend) > 0. Row filters in countDistinctIf must use raw column names only.',
        retryable: true,
      };
    }
    if (msg.includes('UNKNOWN_TABLE') || msg.includes('does not exist')) {
      const table = (runSql.match(/\bFROM\s+(?:`?\w+`?\.)?`?(\w+)`?/i) || [])[1];
      return {
        success: false,
        error: 'TABLE_NOT_FOUND',
        message: table
          ? `ClickHouse table ${table} does not exist. Apply db migrations for meta_ads_insights_daily / google_ads_insights_daily, then ingest via workers.`
          : 'ClickHouse table not found. Apply ads CH migrations and run workers ingestion.',
        retryable: false,
      };
    }
    if (/ECONNREFUSED|connect ETIMEDOUT|ENOTFOUND|ECONNRESET|socket hang up/i.test(msg)) {
      return chUnavailableResult(
        `ClickHouse is not reachable (${msg}). Verify clickhouse.adminLlmChatReadonly / ADMIN_LLM_CHAT_CH_* on this host.`,
      );
    }
    return chUnavailableResult(error.message);
  }
}

const MONETARY_METRICS = /\b(total_revenue|amount_total|spend|conversion_value|conversions_value)\b/i;

/** Warn when revenue/spend was summed without currency in SELECT/GROUP BY. */
function enrichMonetaryResult(result, sql, tables = []) {
  if (!result?.success || !result.rows?.length || !tables.length) return result;
  const table = tables[0];
  const meta = WHITELIST[table];
  const currencyCol = meta?.currency_column;
  if (!currencyCol) return result;
  const sqlLower = String(sql || '').toLowerCase();
  if (!MONETARY_METRICS.test(sqlLower)) return result;
  if (sqlLower.includes(currencyCol)) return result;
  const sample = result.rows[0];
  if (sample && currencyCol in sample) return result;
  return {
    ...result,
    warning: `Amounts were aggregated without ${currencyCol}. Values may mix currencies — re-query with ${currencyCol} in SELECT and GROUP BY ${currencyCol}.`,
    format_hint: 'Present revenue/spend as "<amount> <CURRENCY>" per row, not a bare number.',
    suggested_sql: `SELECT ${currencyCol}, sum(total_revenue) AS total_revenue FROM ${table} WHERE report_date >= '...' AND report_date <= '...' GROUP BY ${currencyCol}`,
  };
}

function listClickhouseTables() {
  return Object.entries(WHITELIST).map(([table, meta]) => ({
    table,
    description: meta.description,
    required_date_column: meta.required_date_column,
  }));
}

function getTableSchema({ table }) {
  if (!WHITELIST[table]) {
    return { success: false, error: 'TABLE_NOT_ALLOWED' };
  }
  const meta = WHITELIST[table];
  const forbidden = meta.required_date_column === 'report_date' ? ['date'] : [];
  const stateCols = meta.aggregate_state_columns || {};
  const stateColNames = Object.keys(stateCols);
  return {
    success: true,
    schema_version: SCHEMA_VERSION,
    table,
    columns: meta.columns || [],
    required_date_column: meta.required_date_column,
    date_filter_example: meta.date_filter_example || null,
    aggregating: Boolean(meta.aggregating),
    description: meta.description,
    forbidden_filter_columns: forbidden,
    currency_column: meta.currency_column || null,
    aggregate_state_columns: stateColNames.length ? stateCols : null,
    aggregate_state_hint: stateColNames.length
      ? `Columns ${stateColNames.join(', ')} are AggregateFunction states. Use ${Object.entries(stateCols).map(([c, fn]) => `${fn}(${c})`).join(', ')} — NOT sum()/count()/uniq().`
      : null,
    hint: meta.required_date_column === 'report_date'
      ? 'Daily stats use report_date — never use `date` in WHERE on this table.'
      : 'Use the date column shown in required_date_column for WHERE filters.',
    revenue_hint: meta.currency_column
      ? `Include ${meta.currency_column} in SELECT and GROUP BY when summing total_revenue, amount_total, or spend.`
      : null,
    related_tables: meta.related_tables || [],
    cross_table_hint: meta.related_tables?.length
      ? 'related_tables are optional ideas — use list_clickhouse_tables to find other tables too.'
      : 'Use list_clickhouse_tables to see other tables that might answer the question.',
  };
}

function buildDateBoundsSql(table, { tz = 'Asia/Kolkata', lookbackDays } = {}) {
  const meta = WHITELIST[table];
  if (!meta) return null;
  const moment = require('moment-timezone');
  const days = lookbackDays ?? CONSTANTS.CH_DATE_BOUNDS_LOOKBACK_DAYS;
  const end = moment.tz(tz).format('YYYY-MM-DD');
  const start = moment.tz(tz).subtract(days, 'days').format('YYYY-MM-DD');
  const col = meta.required_date_column;
  if (col === 'timestamp') {
    return {
      sql: `SELECT min(toDate(timestamp)) AS earliest_date, max(toDate(timestamp)) AS latest_date, count(*) AS row_count FROM ${table} WHERE toDate(timestamp) >= '${start}' AND toDate(timestamp) <= '${end}'`,
      start,
      end,
      lookback_days: days,
    };
  }
  return {
    sql: `SELECT min(${col}) AS earliest_date, max(${col}) AS latest_date, count(*) AS row_count FROM ${table} WHERE ${col} >= '${start}' AND ${col} <= '${end}'`,
    start,
    end,
    lookback_days: days,
  };
}

async function getTableDateBounds({ table, tz = 'Asia/Kolkata' }) {
  if (!isClickHouseReadonlyConfigured() || !readonlyClickhouse) {
    return chUnavailableResult(CH_NOT_CONFIGURED_MSG);
  }
  if (!WHITELIST[table]) {
    return { success: false, error: 'TABLE_NOT_ALLOWED', message: `Table not allowed: ${table}` };
  }
  const meta = WHITELIST[table];
  const built = buildDateBoundsSql(table, { tz });
  const validation = validateClickHouseSql(built.sql);
  if (!validation.ok) {
    return {
      success: false,
      error: validation.code,
      message: validation.message,
      hint: validation.hint,
    };
  }
  const start = Date.now();
  try {
    const { data } = await readonlyClickhouse.querying(validation.sql, { dataObjects: true });
    const row = Array.isArray(data) && data[0] ? data[0] : {};
    return {
      success: true,
      table,
      required_date_column: meta.required_date_column,
      earliest_date: row.earliest_date ?? null,
      latest_date: row.latest_date ?? null,
      row_count: row.row_count ?? 0,
      window_start: built.start,
      window_end: built.end,
      lookback_days: built.lookback_days,
      note: `Bounds are within the last ${built.lookback_days} days (${built.start}–${built.end}). Use get_date_context for relative ranges; always filter query_clickhouse by ${meta.required_date_column}.`,
    };
  } catch (error) {
    const msg = String(error.message || '');
    if (msg.includes('UNKNOWN_TABLE') || msg.includes('does not exist')) {
      return {
        success: false,
        error: 'TABLE_NOT_FOUND',
        message: `ClickHouse table ${table} does not exist.`,
        retryable: false,
      };
    }
    return { ...chUnavailableResult(error.message), query_ms: Date.now() - start };
  }
}

function getDateContext({ tz = 'Asia/Kolkata' }) {
  const moment = require('moment-timezone');
  const now = moment.tz(tz);
  return {
    success: true,
    timezone: tz,
    today: now.format('YYYY-MM-DD'),
    yesterday: now.clone().subtract(1, 'day').format('YYYY-MM-DD'),
    week_ago: now.clone().subtract(7, 'day').format('YYYY-MM-DD'),
    days_28_ago: now.clone().subtract(28, 'day').format('YYYY-MM-DD'),
    note: 'Calendar dates only. In SQL use required_date_column from get_table_schema (report_date for daily stats, date for ads tables).',
  };
}

module.exports = {
  queryClickhouse,
  listClickhouseTables,
  getTableSchema,
  getTableDateBounds,
  buildDateBoundsSql,
  getDateContext,
  pingClickHouseReadonly,
  isClickHouseReadonlyConfigured,
};

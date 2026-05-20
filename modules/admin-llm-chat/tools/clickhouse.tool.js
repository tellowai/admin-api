'use strict';

const { readonlyClickhouse } = require('../../../config/lib/clickhouse.readonly');
const { validateClickHouseSql } = require('./clickhouse.sql.validator');
const WHITELIST = require('../constants/clickhouse.whitelist');
const CONSTANTS = require('../constants/admin-llm-chat.constants');
const { SCHEMA_VERSION } = require('../services/schema.cache.service');

const PII_COLUMNS = new Set(['email', 'phone', 'phone_number', 'mobile', 'address']);

async function queryClickhouse({ sql, max_rows: maxRows }) {
  const validation = validateClickHouseSql(sql);
  if (!validation.ok) {
    return {
      success: false,
      error: validation.code,
      message: validation.message,
      hint: validation.code === 'INVALID_DATE_COLUMN'
        ? 'Call get_table_schema for this table and use required_date_column in WHERE.'
        : undefined,
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
    const redacted = rows.map((row) => redactRow(row));
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
    return { success: false, error: 'CH_UNAVAILABLE', message: error.message, retryable: true };
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

function redactRow(row) {
  const out = { ...row };
  Object.keys(out).forEach((k) => {
    if (PII_COLUMNS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    }
  });
  return out;
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
    hint: meta.required_date_column === 'report_date'
      ? 'Daily stats use report_date — never use `date` in WHERE on this table.'
      : 'Use the date column shown in required_date_column for WHERE filters.',
    revenue_hint: meta.currency_column
      ? `Include ${meta.currency_column} in SELECT and GROUP BY when summing total_revenue, amount_total, or spend.`
      : null,
  };
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
  getDateContext,
};

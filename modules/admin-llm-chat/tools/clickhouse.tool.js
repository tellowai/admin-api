'use strict';

const { readonlyClickhouse } = require('../../../config/lib/clickhouse.readonly');
const { validateClickHouseSql } = require('./clickhouse.sql.validator');
const WHITELIST = require('../constants/clickhouse.whitelist');
const CONSTANTS = require('../constants/admin-llm-chat.constants');

const PII_COLUMNS = new Set(['email', 'phone', 'phone_number', 'mobile', 'address']);

async function queryClickhouse({ sql, max_rows: maxRows }) {
  const validation = validateClickHouseSql(sql);
  if (!validation.ok) {
    return { success: false, error: validation.code, message: validation.message };
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
    return {
      success: true,
      rows: redacted,
      row_count: redacted.length,
      truncated,
      query_ms: Date.now() - start,
    };
  } catch (error) {
    if (String(error.message || '').includes('Timeout')) {
      return { success: false, error: 'QUERY_TIMEOUT', message: error.message };
    }
    return { success: false, error: 'CH_UNAVAILABLE', message: error.message, retryable: true };
  }
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
  return {
    success: true,
    table,
    columns: WHITELIST[table].columns || 'Use DESCRIBE via known schema cache',
    required_date_column: WHITELIST[table].required_date_column,
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
  };
}

module.exports = {
  queryClickhouse,
  listClickhouseTables,
  getTableSchema,
  getDateContext,
};

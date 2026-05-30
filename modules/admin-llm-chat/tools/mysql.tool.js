'use strict';

const { readonlyMysql, readonlyMysqlDatabase } = require('../../../config/lib/mysql.readonly');
const { validateReadOnlyQuery } = require('../../sql-runner/services/sql-runner.service');
const CONSTANTS = require('../constants/admin-llm-chat.constants');
const { redactRows } = require('../services/pii.redactor');

/** Valid MySQL identifier (table/column) — blocks injection in SHOW/DESCRIBE. */
const IDENTIFIER_RE = /^[A-Za-z0-9_]+$/;

function mapMysqlError(error) {
  const msg = String(error?.message || error?.sqlMessage || 'MySQL query failed');
  if (/timeout/i.test(msg)) {
    return { success: false, error: 'QUERY_TIMEOUT', message: msg, retryable: true };
  }
  if (/doesn'?t exist|unknown table|no such table/i.test(msg)) {
    return {
      success: false,
      error: 'TABLE_NOT_FOUND',
      message: msg,
      hint: 'Do not guess table names. Call list_mysql_tables and use an exact name from that list.',
      retryable: false,
    };
  }
  if (/unknown column/i.test(msg)) {
    return {
      success: false,
      error: 'INVALID_COLUMN',
      message: msg,
      hint: 'Call get_mysql_table_schema for this table and use exact column names.',
      retryable: true,
    };
  }
  return { success: false, error: 'MYSQL_UNAVAILABLE', message: msg, retryable: true };
}

async function withConnection(fn) {
  const pool = readonlyMysql.promise();
  const connection = await pool.getConnection();
  try {
    return await fn(connection);
  } finally {
    connection.release();
  }
}

async function listMysqlTables() {
  try {
    return await withConnection(async (connection) => {
      const [rows] = await connection.query('SHOW TABLES');
      const tables = (Array.isArray(rows) ? rows : [])
        .map((r) => Object.values(r)[0])
        .filter(Boolean);
      return {
        success: true,
        database: readonlyMysqlDatabase || null,
        tables,
        table_count: tables.length,
        note: 'MySQL holds transactional/app data (users, orders, templates, credits, etc.). Call get_mysql_table_schema before query_mysql.',
      };
    });
  } catch (error) {
    return mapMysqlError(error);
  }
}

async function getMysqlTableSchema({ table }) {
  if (!table || !IDENTIFIER_RE.test(table)) {
    return { success: false, error: 'INVALID_TABLE_NAME', message: 'Table name must be a plain identifier.' };
  }
  try {
    return await withConnection(async (connection) => {
      const [rows] = await connection.query(`DESCRIBE \`${table}\``);
      const columns = (Array.isArray(rows) ? rows : []).map((r) => ({
        column: r.Field,
        type: r.Type,
        nullable: r.Null === 'YES',
        key: r.Key || null,
        default: r.Default,
        extra: r.Extra || null,
      }));
      return {
        success: true,
        table,
        columns,
        hint: 'SELECT only. Always add a WHERE filter and rely on LIMIT for large tables. PII columns (email, phone, tokens) are redacted in results.',
      };
    });
  } catch (error) {
    return mapMysqlError(error);
  }
}

async function queryMysql({ sql, max_rows: maxRows }) {
  const validation = validateReadOnlyQuery(sql);
  if (!validation.ok) {
    return {
      success: false,
      error: validation.code,
      message: validation.message,
      hint: 'Only SELECT / SHOW / DESCRIBE / EXPLAIN are allowed. Use get_mysql_table_schema to find columns.',
    };
  }

  const limit = Math.min(
    Math.max(Number(maxRows) || CONSTANTS.MYSQL_QUERY_LIMIT_DEFAULT, 1),
    CONSTANTS.MYSQL_QUERY_LIMIT_MAX,
  );

  let runSql = validation.sql;
  if (validation.kind === 'select') {
    runSql = /\bLIMIT\s+\d+/i.test(runSql)
      ? runSql.replace(/\bLIMIT\s+\d+(\s+OFFSET\s+\d+)?\s*$/i, `LIMIT ${limit}`)
      : `${runSql} LIMIT ${limit}`;
  }

  const start = Date.now();
  try {
    return await withConnection(async (connection) => {
      const [rows, fields] = await connection.query(runSql);
      const list = Array.isArray(rows) ? rows : [];
      const redacted = redactRows(list);
      const columns = Array.isArray(fields) && fields.length
        ? fields.map((f) => f.name)
        : (list.length ? Object.keys(list[0]) : []);
      return {
        success: true,
        rows: redacted,
        columns,
        row_count: redacted.length,
        truncated: validation.kind === 'select' && redacted.length >= limit,
        query_ms: Date.now() - start,
      };
    });
  } catch (error) {
    return { ...mapMysqlError(error), query_ms: Date.now() - start };
  }
}

module.exports = {
  listMysqlTables,
  getMysqlTableSchema,
  queryMysql,
};

'use strict';

const { readonlyClickhouse } = require('../../../config/lib/clickhouse.readonly');
const { slaveConn } = require('../../../config/lib/mysql');
const CONSTANTS = require('../constants/sql-runner.constants');

function normalizeSql(sql) {
  return String(sql || '').trim().replace(/;+\s*$/, '');
}

/** @returns {'select'|'show'|'describe'|'explain'|null} */
function getQueryKind(sql) {
  if (/^\s*(WITH\b[\s\S]+\bSELECT\b|SELECT\b)/i.test(sql)) return 'select';
  if (/^\s*SHOW\b/i.test(sql)) return 'show';
  if (/^\s*(DESCRIBE|DESC)\b/i.test(sql)) return 'describe';
  if (/^\s*EXPLAIN\b/i.test(sql)) return 'explain';
  return null;
}

function validateReadOnlyQuery(sql) {
  const trimmed = normalizeSql(sql);
  if (!trimmed) {
    return { ok: false, code: 'EMPTY_QUERY', message: 'SQL query is required.' };
  }

  if (/;\s*\S/.test(trimmed)) {
    return { ok: false, code: 'MULTI_STATEMENT', message: 'Only a single SQL statement is allowed.' };
  }

  if (CONSTANTS.FORBIDDEN_KEYWORDS.test(trimmed)) {
    return { ok: false, code: 'FORBIDDEN_KEYWORD', message: 'Only read-only queries are allowed.' };
  }

  const kind = getQueryKind(trimmed);
  if (!kind) {
    return {
      ok: false,
      code: 'NOT_ALLOWED',
      message: 'Query must be SELECT, SHOW, DESCRIBE, or EXPLAIN.',
    };
  }

  return { ok: true, sql: trimmed, kind };
}

/** @deprecated alias */
function validateSelectOnly(sql) {
  return validateReadOnlyQuery(sql);
}

function stripLimitOffset(sql) {
  return sql
    .replace(/\s+LIMIT\s+\d+(\s+OFFSET\s+\d+)?\s*$/i, '')
    .replace(/\s+OFFSET\s+\d+\s*$/i, '')
    .trim();
}

function applyPagination(sql, limit, offset) {
  const base = stripLimitOffset(sql);
  return `${base} LIMIT ${limit} OFFSET ${offset}`;
}

function paginateRowsInMemory(allRows, limit, offset) {
  const totalCount = allRows.length;
  const capped = allRows.slice(0, CONSTANTS.MAX_METADATA_FETCH);
  const page = capped.slice(offset, offset + limit);
  return {
    rows: page,
    rowCount: page.length,
    hasMore: capped.length > offset + limit,
    totalCount: capped.length,
    totalCountCapped: totalCount > CONSTANTS.MAX_METADATA_FETCH,
  };
}

/** SHOW / DESCRIBE / EXPLAIN: paginate in memory (MySQL SHOW rejects LIMIT; totals need full set). */
function usesInMemoryPagination(engine, kind) {
  return kind === 'show' || kind === 'describe' || kind === 'explain';
}

function buildExecutableSql(sql, engine, kind, limit, offset) {
  if (usesInMemoryPagination(engine, kind)) {
    return sql;
  }
  return applyPagination(sql, limit, offset);
}

function buildCountSql(sql, engine) {
  const base = stripLimitOffset(sql);
  if (engine === 'clickhouse') {
    return `SELECT count() AS __total FROM (${base}) AS __sql_runner_sq`;
  }
  return `SELECT COUNT(*) AS __total FROM (${base}) AS __sql_runner_sq`;
}

function parseCountRow(row) {
  if (!row || typeof row !== 'object') return 0;
  if (row.__total != null) return Number(row.__total);
  const val = Object.values(row)[0];
  return Number(val) || 0;
}

async function fetchTotalCountClickhouse(sql, database) {
  const countSql = buildCountSql(sql, 'clickhouse');
  const { data } = await readonlyClickhouse.querying(countSql, {
    dataObjects: true,
    queryOptions: { database },
  });
  const rows = Array.isArray(data) ? data : [];
  return parseCountRow(rows[0]);
}

async function fetchTotalCountMysql(connection, sql) {
  const countSql = buildCountSql(sql, 'mysql');
  const [rows] = await connection.query(countSql);
  return parseCountRow(rows[0]);
}

function finalizeResult(rawRows, columns, limit, offset, queryMs, engine, kind, totalCount = null) {
  if (usesInMemoryPagination(engine, kind)) {
    const paginated = paginateRowsInMemory(rawRows, limit, offset);
    return {
      rows: paginated.rows,
      columns,
      rowCount: paginated.rowCount,
      limit,
      offset,
      hasMore: paginated.hasMore,
      totalCount: paginated.totalCount,
      totalCountCapped: paginated.totalCountCapped,
      queryMs,
    };
  }

  const rowCount = rawRows.length;
  const hasMore = totalCount != null
    ? offset + rowCount < totalCount
    : rowCount === limit;

  return {
    rows: rawRows,
    columns,
    rowCount,
    limit,
    offset,
    hasMore,
    totalCount,
    totalCountCapped: false,
    queryMs,
  };
}

function isDatabaseAllowed(engine, database) {
  if (!CONSTANTS.DATABASE_NAME_REGEX.test(database)) {
    return false;
  }
  const allowed = engine === 'clickhouse'
    ? CONSTANTS.ALLOWED_CLICKHOUSE
    : CONSTANTS.ALLOWED_MYSQL;
  return allowed.has(database);
}

function getDefaultDatabase(engine) {
  return engine === 'clickhouse' ? CONSTANTS.CH_DEFAULT_DB : CONSTANTS.MYSQL_DEFAULT_DB;
}

function filterDatabaseNames(engine, names) {
  const blocked = engine === 'clickhouse'
    ? CONSTANTS.BLOCKED_CLICKHOUSE
    : CONSTANTS.BLOCKED_MYSQL;
  const allowed = engine === 'clickhouse'
    ? CONSTANTS.ALLOWED_CLICKHOUSE
    : CONSTANTS.ALLOWED_MYSQL;

  const unique = [...new Set(
    (names || [])
      .map((n) => String(n).trim())
      .filter((n) => n && CONSTANTS.DATABASE_NAME_REGEX.test(n)),
  )];

  return unique
    .filter((n) => !blocked.has(n) && allowed.has(n))
    .sort((a, b) => a.localeCompare(b));
}

async function fetchClickhouseDatabaseNames() {
  const { data } = await readonlyClickhouse.querying('SHOW DATABASES', { dataObjects: true });
  const rows = Array.isArray(data) ? data : [];
  return rows.map((row) => row.name || row.database || Object.values(row)[0]);
}

async function fetchMysqlDatabaseNames() {
  const pool = slaveConn.promise();
  const [rows] = await pool.query('SHOW DATABASES');
  return rows.map((row) => row.Database);
}

async function listDatabases(engine) {
  const defaultDb = getDefaultDatabase(engine);
  let visible = [];

  try {
    visible = engine === 'clickhouse'
      ? await fetchClickhouseDatabaseNames()
      : await fetchMysqlDatabaseNames();
  } catch (error) {
    return {
      success: false,
      error: 'LIST_DATABASES_FAILED',
      message: error.message,
    };
  }

  const databases = filterDatabaseNames(engine, visible);
  const fallback = isDatabaseAllowed(engine, defaultDb) ? defaultDb : databases[0] || null;

  return {
    success: true,
    databases,
    default: databases.includes(defaultDb) ? defaultDb : fallback,
  };
}

function rowsToResult(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const columns = list.length > 0 ? Object.keys(list[0]) : [];
  return { rows: list, columns, rowCount: list.length };
}

async function runClickhouse(sql, database, limit, offset, kind) {
  const engine = 'clickhouse';
  const executableSql = buildExecutableSql(sql, engine, kind, limit, offset);
  const start = Date.now();
  const { data } = await readonlyClickhouse.querying(executableSql, {
    dataObjects: true,
    queryOptions: { database },
  });
  const rows = Array.isArray(data) ? data : [];
  const { columns } = rowsToResult(rows);

  let totalCount = null;
  if (kind === 'select') {
    try {
      totalCount = await fetchTotalCountClickhouse(sql, database);
    } catch {
      totalCount = null;
    }
  }

  return finalizeResult(
    rows,
    columns,
    limit,
    offset,
    Date.now() - start,
    engine,
    kind,
    totalCount,
  );
}

async function runMysql(sql, database, limit, offset, kind) {
  const engine = 'mysql';
  const executableSql = buildExecutableSql(sql, engine, kind, limit, offset);
  const start = Date.now();
  const pool = slaveConn.promise();
  const connection = await pool.getConnection();

  try {
    await connection.query(`USE \`${database}\``);
    const [rows, fields] = await connection.query(executableSql);
    const list = Array.isArray(rows) ? rows : [];
    const columns = Array.isArray(fields) && fields.length
      ? fields.map((f) => f.name)
      : (list.length ? Object.keys(list[0]) : []);

    let totalCount = null;
    if (kind === 'select') {
      try {
        totalCount = await fetchTotalCountMysql(connection, sql);
      } catch {
        totalCount = null;
      }
    }

    return finalizeResult(
      list,
      columns,
      limit,
      offset,
      Date.now() - start,
      engine,
      kind,
      totalCount,
    );
  } finally {
    connection.release();
  }
}

async function runQuery({ engine, database, sql, limit, offset }) {
  if (!isDatabaseAllowed(engine, database)) {
    return {
      success: false,
      error: 'DATABASE_NOT_ALLOWED',
      message: `Database "${database}" is not allowed for ${engine}.`,
    };
  }

  const validation = validateReadOnlyQuery(sql);
  if (!validation.ok) {
    return { success: false, ...validation };
  }

  const safeLimit = Math.min(Math.max(limit || CONSTANTS.DEFAULT_LIMIT, 1), CONSTANTS.MAX_LIMIT);
  const safeOffset = Math.max(offset || 0, 0);

  try {
    const result = engine === 'clickhouse'
      ? await runClickhouse(validation.sql, database, safeLimit, safeOffset, validation.kind)
      : await runMysql(validation.sql, database, safeLimit, safeOffset, validation.kind);

    return { success: true, ...result };
  } catch (error) {
    const msg = String(error.message || 'Query execution failed');
    if (/timeout/i.test(msg)) {
      return { success: false, error: 'QUERY_TIMEOUT', message: msg };
    }
    return { success: false, error: 'QUERY_FAILED', message: msg };
  }
}

module.exports = {
  listDatabases,
  runQuery,
  validateReadOnlyQuery,
  validateSelectOnly,
  getQueryKind,
  isDatabaseAllowed,
};

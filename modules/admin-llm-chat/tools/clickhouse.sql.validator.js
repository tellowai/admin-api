'use strict';

const { Parser } = require('node-sql-parser');
const WHITELIST = require('../constants/clickhouse.whitelist');
const CONSTANTS = require('../constants/admin-llm-chat.constants');

const parser = new Parser();

/** SYSTEM omitted — `system.*` schemas are blocked via table whitelist instead. */
const FORBIDDEN_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|ATTACH|DETACH|OPTIMIZE|RENAME|GRANT|REVOKE|KILL|SET|FORMAT)\b/i;

/** Tables referenced in FROM (first table only for single-table queries). */
function extractTablesFromSql(sql) {
  const fromMatch = sql.match(/\bFROM\s+(?:`?(\w+)`?\.)?`?(\w+)`?/i);
  return fromMatch ? [fromMatch[2]] : [];
}

/** Fix common model mistakes before validation/execution. */
function preprocessClickHouseSql(sql) {
  const trimmed = String(sql || '').trim().replace(/;+\s*$/, '');
  const tables = extractTablesFromSql(trimmed);
  let out = rewriteIlikeForClickHouse(trimmed);
  out = normalizeDateColumnInSql(out, tables);
  out = rewriteSelectStar(out, tables);
  return { sql: out, tables };
}

/** Rewrite mistaken `date` predicate to the table's real date column (e.g. report_date). */
function normalizeDateColumnInSql(sql, tables = []) {
  let out = sql;
  const datePred = /\bdate\b(?=\s*[=<>]|\s*=|\s+BETWEEN|\s+IN\b)/gi;
  for (const table of tables) {
    const meta = WHITELIST[table];
    if (!meta || meta.required_date_column === 'date') continue;
    const col = meta.required_date_column;
    out = out.replace(datePred, col);
  }
  return out;
}

/**
 * node-sql-parser (MySQL dialect) rejects ClickHouse ILIKE — rewrite before astify.
 * Containment patterns (%x%) → positionCaseInsensitive; other patterns → lower() LIKE.
 */
function rewriteIlikeForClickHouse(sql) {
  return sql.replace(
    /(`[^`]+`|[a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)?)\s+ILIKE\s+'((?:[^'\\]|\\.)*)'/gi,
    (_, col, pattern) => {
      const hasPrefix = pattern.startsWith('%');
      const hasSuffix = pattern.endsWith('%');
      const core = pattern.slice(hasPrefix ? 1 : 0, hasSuffix ? -1 : pattern.length);
      const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      if (hasPrefix && hasSuffix && core.length > 0) {
        return `positionCaseInsensitive(${col}, '${esc(core)}') > 0`;
      }
      return `lower(toString(${col})) LIKE lower('${esc(pattern)}')`;
    },
  );
}

/** Replace SELECT * with explicit allow-listed columns (clearer errors + avoids SELECT *). */
function rewriteSelectStar(sql, tables = []) {
  if (!/\bSELECT\s+\*\s+FROM\b/i.test(sql) || !tables.length) return sql;
  const meta = WHITELIST[tables[0]];
  const cols = meta?.columns;
  if (!cols?.length) return sql;
  return sql.replace(/\bSELECT\s+\*/i, `SELECT ${cols.join(', ')}`);
}

function validateClickHouseSql(sql) {
  const { sql: preprocessed, tables: preTables } = preprocessClickHouseSql(sql);
  const trimmed = preprocessed;
  if (!trimmed) {
    return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'Empty query' };
  }
  if (trimmed.includes(';')) {
    return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'Multiple statements not allowed' };
  }
  if (FORBIDDEN_KEYWORDS.test(trimmed)) {
    return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'Forbidden keyword' };
  }
  if (/\bJOIN\b/i.test(trimmed)) {
    return { ok: false, code: 'JOIN_NOT_ALLOWED', message: 'JOIN not allowed' };
  }
  if (/\bUNION\b/i.test(trimmed)) {
    return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'UNION not allowed' };
  }
  if (/\bINTO\s+OUTFILE\b/i.test(trimmed)) {
    return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'INTO OUTFILE not allowed' };
  }

  const wrongDateCol = checkWrongDateColumn(trimmed);
  if (wrongDateCol) return wrongDateCol;

  const dateCheck = checkRequiredDatePredicate(trimmed);
  if (dateCheck) return dateCheck;

  let ast;
  try {
    ast = parser.astify(trimmed, { database: 'MySQL' });
  } catch (e) {
    const onParseFail = checkRequiredDatePredicate(trimmed);
    if (onParseFail) return onParseFail;
    return { ok: false, code: 'QUERY_NOT_ALLOWED', message: e.message };
  }

  const type = ast.type || ast.ast?.type;
  if (type !== 'select' && !(ast.with && ast.type === 'select')) {
    return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'Only SELECT allowed' };
  }

  const tableNames = extractTables(ast);
  if (!tableNames.length) {
    return { ok: false, code: 'TABLE_NOT_ALLOWED', message: 'No table found' };
  }
  for (const t of tableNames) {
    if (!WHITELIST[t]) {
      return { ok: false, code: 'TABLE_NOT_ALLOWED', message: `Table not allowed: ${t}` };
    }
  }

  let finalSql = trimmed;
  if (!/\bLIMIT\b/i.test(finalSql)) {
    finalSql += ` LIMIT ${CONSTANTS.CH_QUERY_LIMIT_DEFAULT}`;
  } else {
    const limitMatch = finalSql.match(/\bLIMIT\s+(\d+)/i);
    if (limitMatch && parseInt(limitMatch[1], 10) > CONSTANTS.CH_QUERY_LIMIT_MAX) {
      return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'LIMIT too high' };
    }
  }

  return { ok: true, sql: finalSql, tables: tableNames };
}

function checkWrongDateColumn(sql) {
  const table = extractTablesFromSql(sql)[0];
  if (!table) return null;
  const meta = WHITELIST[table];
  if (!meta || meta.required_date_column === 'date') return null;
  const col = meta.required_date_column;
  const datePred = /\bdate\b(?=\s*[=<>]|\s*=|\s+BETWEEN|\s+IN\b)/i;
  if (datePred.test(sql) && !new RegExp(`\\b${col}\\b`, 'i').test(sql)) {
    return {
      ok: false,
      code: 'INVALID_DATE_COLUMN',
      message: `Table ${table} has no column "date". Use "${col}" in WHERE (e.g. WHERE ${col} = 'YYYY-MM-DD'). Call get_table_schema first.`,
    };
  }
  return null;
}

function checkRequiredDatePredicate(sql) {
  const fromMatch = sql.match(/\bFROM\s+(?:`?(\w+)`?\.)?`?(\w+)`?/i);
  if (!fromMatch) return null;
  const table = fromMatch[2];
  const meta = WHITELIST[table];
  if (!meta) return null;
  const lower = sql.toLowerCase();
  const dateCol = meta.required_date_column.toLowerCase();
  if (!lower.includes('where') || !lower.includes(dateCol)) {
    return {
      ok: false,
      code: 'DATE_PREDICATE_REQUIRED',
      message: `WHERE must filter on ${meta.required_date_column}`,
    };
  }
  return null;
}

function extractTables(ast) {
  const tables = [];
  const from = ast.from || ast.ast?.from;
  if (!from) return tables;
  const list = Array.isArray(from) ? from : [from];
  list.forEach((f) => {
    let name = f.table || f.db || f.as;
    if (f.db && f.table) name = f.table;
    if (name && typeof name === 'string') tables.push(name.replace(/`/g, ''));
  });
  return tables;
}

module.exports = {
  validateClickHouseSql,
  preprocessClickHouseSql,
  normalizeDateColumnInSql,
  rewriteSelectStar,
  rewriteIlikeForClickHouse,
};

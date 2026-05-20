'use strict';

const { Parser } = require('node-sql-parser');
const WHITELIST = require('../constants/clickhouse.whitelist');
const CONSTANTS = require('../constants/admin-llm-chat.constants');

const parser = new Parser();

/** SYSTEM omitted — `system.*` schemas are blocked via table whitelist instead. */
const FORBIDDEN_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|ATTACH|DETACH|OPTIMIZE|RENAME|GRANT|REVOKE|KILL|SET|FORMAT)\b/i;

function validateClickHouseSql(sql) {
  const trimmed = String(sql || '').trim().replace(/;+\s*$/, '');
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

module.exports = { validateClickHouseSql };

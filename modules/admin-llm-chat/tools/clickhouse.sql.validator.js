'use strict';

const { Parser } = require('node-sql-parser');
const WHITELIST = require('../constants/clickhouse.whitelist');
const CONSTANTS = require('../constants/admin-llm-chat.constants');

const parser = new Parser();

/** SYSTEM omitted — `system.*` schemas are blocked via table whitelist instead. */
const FORBIDDEN_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|ATTACH|DETACH|OPTIMIZE|RENAME|GRANT|REVOKE|KILL|SET|SETTINGS|FORMAT)\b/i;

/** Tables referenced in FROM (first table only for single-table queries). */
function extractTablesFromSql(sql) {
  const all = extractAllTablesFromSql(sql);
  return all.length ? [all[0]] : [];
}

/** All tables referenced via FROM (used as parser-fallback for CH-only syntax). */
function extractAllTablesFromSql(sql) {
  const tables = [];
  const re = /\bFROM\s+(?:`?(\w+)`?\.)?`?(\w+)`?/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    tables.push(m[2]);
  }
  return tables;
}

/** Fix common model mistakes before validation/execution. */
function preprocessClickHouseSql(sql) {
  const trimmed = String(sql || '').trim().replace(/;+\s*$/, '');
  const tables = extractTablesFromSql(trimmed);
  let out = rewriteIlikeForClickHouse(trimmed);
  out = rewriteShadowedAggregateAliases(out);
  out = normalizeDateColumnInSql(out, tables);
  out = rewriteSelectStar(out, tables);
  out = rewriteClickHouseAggregateShorthands(out);
  out = rewriteAggregateStateColumns(out, tables);
  return { sql: out, tables };
}

/**
 * Columns typed `AggregateFunction(uniq, ...)` (etc.) cannot be passed to plain
 * sum/count/avg/uniq — ClickHouse returns ILLEGAL_TYPE_OF_ARGUMENT. Rewrite to
 * the matching *Merge function so the model doesn't have to know per-column
 * storage types.
 */
function rewriteAggregateStateColumns(sql, tables = []) {
  const merges = new Map();
  for (const table of tables) {
    const meta = WHITELIST[table];
    if (!meta?.aggregate_state_columns) continue;
    Object.entries(meta.aggregate_state_columns).forEach(([col, mergeFn]) => {
      merges.set(col.toLowerCase(), mergeFn);
    });
  }
  if (!merges.size) return sql;
  const wrongFns = '(?:sum|count|avg|min|max|uniq|uniqExact|any|anyLast)';
  return sql.replace(
    new RegExp(`\\b${wrongFns}\\s*\\(\\s*([a-zA-Z_][\\w]*)\\s*\\)`, 'gi'),
    (match, col) => {
      const mergeFn = merges.get(col.toLowerCase());
      return mergeFn ? `${mergeFn}(${col})` : match;
    },
  );
}

/**
 * ClickHouse allows zero-arg aggregates (e.g. `count()`) that node-sql-parser's
 * MySQL grammar rejects. Rewrite to the SQL-standard form before astify.
 */
function rewriteClickHouseAggregateShorthands(sql) {
  return sql.replace(/\bcount\s*\(\s*\)/gi, 'count(*)');
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

/**
 * ClickHouse: sum(spend) AS spend makes bare `spend` in countDistinctIf/HAVING refer to the
 * aggregate alias → ILLEGAL_AGGREGATION. Rename shadowed aliases; fix HAVING/ORDER BY refs.
 */
function rewriteShadowedAggregateAliases(sql) {
  const renames = new Map();
  const shadowRe = /\b(sum|avg|min|max|count)\s*\(\s*([a-zA-Z_]\w*)\s*\)\s+AS\s+\2\b/gi;
  let out = sql.replace(shadowRe, (match, fn, col) => {
    const alias = `agg_${col}`;
    renames.set(col.toLowerCase(), { col, alias, fn: fn.toLowerCase() });
    return `${fn}(${col}) AS ${alias}`;
  });
  if (!renames.size) return out;

  const replaceClause = (keyword, body) => {
    let clause = body;
    renames.forEach(({ col, alias }) => {
      clause = clause.replace(new RegExp(`\\b${col}\\b`, 'gi'), alias);
    });
    return `${keyword}${clause}`;
  };

  out = out.replace(/\bHAVING\b([\s\S]*?)(?=\bORDER\s+BY\b|\bLIMIT\b|$)/i, (m, body) => (
    replaceClause('HAVING', body)
  ));
  out = out.replace(/\bORDER\s+BY\b([\s\S]*?)(?=\bLIMIT\b|$)/i, (m, body) => (
    replaceClause('ORDER BY', body)
  ));
  return out;
}

/** Replace SELECT * with explicit allow-listed columns (clearer errors + avoids SELECT *). */
function rewriteSelectStar(sql, tables = []) {
  if (!/\bSELECT\s+\*\s+FROM\b/i.test(sql) || !tables.length) return sql;
  const meta = WHITELIST[tables[0]];
  const cols = meta?.columns;
  if (!cols?.length) return sql;
  return sql.replace(/\bSELECT\s+\*/i, `SELECT ${cols.join(', ')}`);
}

/** Split UNION ALL branches; outer ORDER BY stays on the full query only. */
function splitUnionAllBranches(sql) {
  const orderMatch = sql.match(/\s+ORDER\s+BY\s+[\s\S]+$/i);
  const core = orderMatch ? sql.slice(0, orderMatch.index).trim() : sql;
  const orderSuffix = orderMatch ? orderMatch[0] : '';
  const branches = core.split(/\s+UNION\s+ALL\s+/i).map((b) => b.trim()).filter(Boolean);
  return { branches, orderSuffix };
}

/** Validate one SELECT branch (no UNION). */
function validateClickHouseSelectBranch(trimmed) {
  if (!trimmed) {
    return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'Empty query' };
  }
  if (FORBIDDEN_KEYWORDS.test(trimmed)) {
    return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'Forbidden keyword' };
  }
  if (/\bJOIN\b/i.test(trimmed)) {
    return { ok: false, code: 'JOIN_NOT_ALLOWED', message: 'JOIN not allowed' };
  }
  if (/\bUNION\b/i.test(trimmed)) {
    return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'Nested UNION not allowed' };
  }
  if (/\bINTO\s+OUTFILE\b/i.test(trimmed)) {
    return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'INTO OUTFILE not allowed' };
  }

  const wrongDateCol = checkWrongDateColumn(trimmed);
  if (wrongDateCol) return wrongDateCol;

  const dateCheck = checkRequiredDatePredicate(trimmed);
  if (dateCheck) return dateCheck;

  if (!/^\s*(WITH\b|SELECT\b)/i.test(trimmed)) {
    return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'Only SELECT allowed' };
  }

  let tableNames;
  try {
    const ast = parser.astify(trimmed, { database: 'MySQL' });
    const type = ast.type || ast.ast?.type;
    if (type !== 'select' && !(ast.with && ast.type === 'select')) {
      return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'Only SELECT allowed' };
    }
    tableNames = extractTables(ast);
  } catch (_e) {
    tableNames = [];
  }
  if (!tableNames?.length) {
    tableNames = extractAllTablesFromSql(trimmed);
  }

  if (!tableNames || !tableNames.length) {
    return { ok: false, code: 'TABLE_NOT_ALLOWED', message: 'No table found' };
  }
  for (const t of tableNames) {
    if (!WHITELIST[t]) {
      return { ok: false, code: 'TABLE_NOT_ALLOWED', message: `Table not allowed: ${t}` };
    }
  }

  return { ok: true, tables: tableNames };
}

function validateUnionAllQuery(trimmed) {
  if (!/\bUNION\s+ALL\b/i.test(trimmed)) return null;
  const withoutBareUnion = trimmed.replace(/\bUNION\s+ALL\b/gi, '');
  if (/\bUNION\b/i.test(withoutBareUnion)) {
    return {
      ok: false,
      code: 'QUERY_NOT_ALLOWED',
      message: 'Only UNION ALL is allowed (use UNION ALL for period comparisons)',
    };
  }

  const { branches, orderSuffix } = splitUnionAllBranches(trimmed);
  if (branches.length < 2) {
    return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'Invalid UNION ALL query' };
  }

  const tableSet = new Set();
  for (const branch of branches) {
    const branchResult = validateClickHouseSelectBranch(branch);
    if (!branchResult.ok) return branchResult;
    branchResult.tables.forEach((t) => tableSet.add(t));
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

  return { ok: true, sql: finalSql, tables: [...tableSet] };
}

function validateClickHouseSql(sql) {
  const { sql: preprocessed } = preprocessClickHouseSql(sql);
  const trimmed = preprocessed;
  if (!trimmed) {
    return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'Empty query' };
  }
  if (trimmed.includes(';')) {
    return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'Multiple statements not allowed' };
  }

  if (/\bUNION\s+ALL\b/i.test(trimmed)) {
    return validateUnionAllQuery(trimmed);
  }
  if (/\bUNION\b/i.test(trimmed)) {
    return {
      ok: false,
      code: 'QUERY_NOT_ALLOWED',
      message: 'UNION not allowed — use UNION ALL for current vs prior period comparisons',
    };
  }

  const branchResult = validateClickHouseSelectBranch(trimmed);
  if (!branchResult.ok) return branchResult;

  let finalSql = trimmed;
  if (!/\bLIMIT\b/i.test(finalSql)) {
    finalSql += ` LIMIT ${CONSTANTS.CH_QUERY_LIMIT_DEFAULT}`;
  } else {
    const limitMatch = finalSql.match(/\bLIMIT\s+(\d+)/i);
    if (limitMatch && parseInt(limitMatch[1], 10) > CONSTANTS.CH_QUERY_LIMIT_MAX) {
      return { ok: false, code: 'QUERY_NOT_ALLOWED', message: 'LIMIT too high' };
    }
  }

  return { ok: true, sql: finalSql, tables: branchResult.tables };
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
  const tables = extractAllTablesFromSql(sql);
  if (!tables.length) return null;
  const lower = sql.toLowerCase();
  if (!lower.includes('where')) {
    const table = tables[0];
    const meta = WHITELIST[table];
    return {
      ok: false,
      code: 'DATE_PREDICATE_REQUIRED',
      message: meta
        ? `WHERE must filter on ${meta.required_date_column}`
        : 'WHERE with a date filter is required',
      hint: 'Do not run min(date)/max(date) without a date filter. Call get_table_date_bounds for earliest/latest dates, or get_date_context and filter a bounded range (e.g. last 28 days).',
    };
  }
  for (const table of tables) {
    const meta = WHITELIST[table];
    if (!meta) continue;
    const dateCol = meta.required_date_column.toLowerCase();
    if (!lower.includes(dateCol)) {
      return {
        ok: false,
        code: 'DATE_PREDICATE_REQUIRED',
        message: `WHERE must filter on ${meta.required_date_column}`,
        hint: 'Do not run min(date)/max(date) without a date filter. Call get_table_date_bounds for earliest/latest dates, or get_date_context and filter a bounded range (e.g. last 28 days).',
      };
    }
  }
  return null;
}

/** Collect whitelisted table names from a SELECT AST (including subqueries in FROM). */
function extractTables(ast) {
  const tables = [];
  const seen = new Set();

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    const select = node.type === 'select' ? node : node.ast;
    if (!select || select.type !== 'select') return;

    const from = select.from;
    const list = from ? (Array.isArray(from) ? from : [from]) : [];
    list.forEach((f) => {
      if (f?.expr?.ast) {
        walk(f.expr.ast);
        return;
      }
      let name = f?.table;
      if (f?.db && f?.table) name = f.table;
      if (name && typeof name === 'string') {
        const t = name.replace(/`/g, '');
        if (!seen.has(t)) {
          seen.add(t);
          tables.push(t);
        }
      }
    });

    if (select.with) {
      const ctes = Array.isArray(select.with) ? select.with : [select.with];
      ctes.forEach((cte) => {
        if (cte?.stmt?.ast) walk(cte.stmt.ast);
      });
    }
  }

  walk(ast);
  return tables;
}

module.exports = {
  validateClickHouseSql,
  preprocessClickHouseSql,
  normalizeDateColumnInSql,
  rewriteSelectStar,
  rewriteIlikeForClickHouse,
  rewriteShadowedAggregateAliases,
};

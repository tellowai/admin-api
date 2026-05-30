'use strict';

const config = require('../../../config/config');

const chConfig = config.clickhouse?.adminLlmChatReadonly
  || config.clickhouse?.slave
  || config.clickhouse?.master
  || {};
const mysqlSlave = config.mysql?.slave || config.mysql?.master || {};

const CH_DEFAULT_DB = chConfig.databaseName || 'default';
const MYSQL_DEFAULT_DB = mysqlSlave.databaseName || '';

/** Databases never offered in the UI even if visible via SHOW DATABASES. */
const BLOCKED_CLICKHOUSE = new Set([
  'system',
  'information_schema',
  'INFORMATION_SCHEMA',
]);

const BLOCKED_MYSQL = new Set([
  'mysql',
  'information_schema',
  'performance_schema',
  'sys',
]);

const DATABASE_NAME_REGEX = /^[A-Za-z0-9_]+$/;

/**
 * Explicit allow-list per engine. Intersected with SHOW DATABASES at list time.
 * Extend arrays here or via config.sqlRunner.allowedDatabases in env/local.js.
 */
function buildAllowedSet(extra, defaultDb) {
  const names = [...(extra || []), defaultDb]
    .map((d) => String(d).trim())
    .filter((d) => d && DATABASE_NAME_REGEX.test(d));
  return new Set(names);
}

const ALLOWED_CLICKHOUSE = buildAllowedSet(
  config.sqlRunner?.allowedDatabases?.clickhouse,
  CH_DEFAULT_DB,
);

const ALLOWED_MYSQL = buildAllowedSet(
  config.sqlRunner?.allowedDatabases?.mysql,
  MYSQL_DEFAULT_DB,
);

const ENGINES = Object.freeze(['clickhouse', 'mysql']);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Max rows fetched before in-app pagination for DESCRIBE / EXPLAIN. */
const MAX_METADATA_FETCH = 1000;

const FORBIDDEN_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE|RENAME|ATTACH|DETACH|OPTIMIZE|SET|CALL|LOAD|HANDLER|LOCK|UNLOCK|MERGE|EXECUTE|EXEC|KILL|OUTFILE|INFILE)\b/i;

module.exports = {
  ENGINES,
  CH_DEFAULT_DB,
  MYSQL_DEFAULT_DB,
  BLOCKED_CLICKHOUSE,
  BLOCKED_MYSQL,
  ALLOWED_CLICKHOUSE,
  ALLOWED_MYSQL,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_METADATA_FETCH,
  FORBIDDEN_KEYWORDS,
  DATABASE_NAME_REGEX,
};

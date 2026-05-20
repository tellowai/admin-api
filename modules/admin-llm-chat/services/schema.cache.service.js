'use strict';

const WHITELIST = require('../constants/clickhouse.whitelist');
const CONSTANTS = require('../constants/admin-llm-chat.constants');

const CACHE_KEY = `${CONSTANTS.REDIS_PREFIX}:ch_schema_snapshot`;
const TTL_SEC = 6 * 60 * 60;

const SCHEMA_VERSION = 2;

function buildFromWhitelist() {
  return Object.fromEntries(
    Object.entries(WHITELIST).map(([table, meta]) => [
      table,
      {
        schema_version: SCHEMA_VERSION,
        description: meta.description,
        required_date_column: meta.required_date_column,
        columns: meta.columns || [],
        date_filter_example: meta.date_filter_example || null,
        aggregating: Boolean(meta.aggregating),
        pii_columns: meta.pii_columns || [],
        forbidden_filter_columns: meta.required_date_column === 'report_date' ? ['date'] : [],
      },
    ]),
  );
}

/** Drop corrupt Redis snapshots (legacy shape used string columns + wrong date column). */
function isValidSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const entry = snapshot.orders_daily_stats || snapshot.attribution_daily_stats;
  if (!entry) return false;
  if (typeof entry.columns === 'string') return false;
  if (!Array.isArray(entry.columns) || !entry.columns.length) return false;
  if (entry.required_date_column !== WHITELIST.orders_daily_stats?.required_date_column) return false;
  return true;
}

function mergeWithWhitelist(snapshot) {
  const canonical = buildFromWhitelist();
  if (!isValidSnapshot(snapshot)) return canonical;
  const merged = { ...canonical };
  for (const [table, meta] of Object.entries(snapshot)) {
    if (!WHITELIST[table] || !meta || typeof meta !== 'object') continue;
    merged[table] = {
      ...canonical[table],
      ...meta,
      required_date_column: WHITELIST[table].required_date_column,
      columns: WHITELIST[table].columns || [],
      date_filter_example: WHITELIST[table].date_filter_example || null,
      schema_version: SCHEMA_VERSION,
    };
  }
  return merged;
}

async function getRedis() {
  try {
    const redis = require('../../../config/lib/redis');
    return redis.redisClient;
  } catch (_e) {
    return null;
  }
}

async function getSchemaSnapshot() {
  const canonical = buildFromWhitelist();
  const client = await getRedis();
  if (client?.isReady) {
    try {
      const raw = await client.get(CACHE_KEY);
      if (raw) return mergeWithWhitelist(JSON.parse(raw));
    } catch (_e) { /* fall through */ }
  }
  return canonical;
}

async function refreshSchemaSnapshot(columnsByTable) {
  const snapshot = mergeWithWhitelist(columnsByTable || buildFromWhitelist());
  const client = await getRedis();
  if (client?.isReady) {
    await client.setEx(CACHE_KEY, TTL_SEC, JSON.stringify(snapshot));
  }
  return snapshot;
}

module.exports = {
  getSchemaSnapshot,
  refreshSchemaSnapshot,
  buildFromWhitelist,
  mergeWithWhitelist,
  isValidSnapshot,
  CACHE_KEY,
  SCHEMA_VERSION,
};

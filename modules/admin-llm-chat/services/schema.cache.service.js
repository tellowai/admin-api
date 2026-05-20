'use strict';

const WHITELIST = require('../constants/clickhouse.whitelist');
const CONSTANTS = require('../constants/admin-llm-chat.constants');

const CACHE_KEY = `${CONSTANTS.REDIS_PREFIX}:ch_schema_snapshot`;
const TTL_SEC = 6 * 60 * 60;

function buildFromWhitelist() {
  return Object.fromEntries(
    Object.entries(WHITELIST).map(([table, meta]) => [
      table,
      {
        description: meta.description,
        required_date_column: meta.required_date_column,
        pii_columns: meta.pii_columns || [],
      },
    ]),
  );
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
  const client = await getRedis();
  if (client?.isReady) {
    try {
      const raw = await client.get(CACHE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_e) { /* fall through */ }
  }
  return buildFromWhitelist();
}

async function refreshSchemaSnapshot(columnsByTable) {
  const snapshot = columnsByTable || buildFromWhitelist();
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
  CACHE_KEY,
};

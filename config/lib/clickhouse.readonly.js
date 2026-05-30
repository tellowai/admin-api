'use strict';

const config = require('../config');
const ClickHouse = require('@apla/clickhouse');

/**
 * Dedicated read-only ClickHouse user for admin LLM chat.
 * Never falls back to master/slave (write-capable) pools.
 *
 * Configure in config/env/<NODE_ENV>.js under clickhouse.adminLlmChatReadonly,
 * or via ADMIN_LLM_CHAT_CH_HOST / _PORT / _DATABASE / _USER / _PASSWORD.
 */
function resolveReadonlyConfig() {
  const base = config.clickhouse?.adminLlmChatReadonly || {};
  const fromEnv = (key) => {
    const v = process.env[key];
    return v === undefined || v === '' ? undefined : v;
  };
  return {
    url: fromEnv('ADMIN_LLM_CHAT_CH_HOST') || base.url,
    port: fromEnv('ADMIN_LLM_CHAT_CH_PORT') || base.port,
    databaseName: fromEnv('ADMIN_LLM_CHAT_CH_DATABASE') || base.databaseName,
    user: fromEnv('ADMIN_LLM_CHAT_CH_USER') ?? base.user,
    password: fromEnv('ADMIN_LLM_CHAT_CH_PASSWORD') ?? base.password,
    debug: base.debug,
  };
}

const chConfig = resolveReadonlyConfig();

function isClickHouseReadonlyConfigured() {
  return Boolean(String(chConfig.url || '').trim() && String(chConfig.port || '').trim());
}

const options = isClickHouseReadonlyConfigured()
  ? {
    host: chConfig.url,
    port: chConfig.port,
    user: chConfig.user,
    password: chConfig.password,
    queryOptions: {
      database: chConfig.databaseName,
      max_execution_time: 30,
      max_result_rows: 100000,
      readonly: 2,
    },
  }
  : null;

const readonlyClickhouse = options ? new ClickHouse(options) : null;

const CH_NOT_CONFIGURED_MSG =
  'ClickHouse is not configured for admin LLM chat. Set clickhouse.adminLlmChatReadonly '
  + 'in config/env/<NODE_ENV>.js (same host as analytics ClickHouse, read-only user), '
  + 'or set ADMIN_LLM_CHAT_CH_HOST, ADMIN_LLM_CHAT_CH_PORT, ADMIN_LLM_CHAT_CH_DATABASE, '
  + 'ADMIN_LLM_CHAT_CH_USER, ADMIN_LLM_CHAT_CH_PASSWORD.';

async function pingClickHouseReadonly() {
  if (!readonlyClickhouse) {
    return { ok: false, reason: 'not_configured', message: CH_NOT_CONFIGURED_MSG };
  }
  try {
    await readonlyClickhouse.querying('SELECT 1 AS ok', { dataObjects: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'unreachable', message: error.message };
  }
}

module.exports = {
  readonlyClickhouse,
  isClickHouseReadonlyConfigured,
  pingClickHouseReadonly,
  CH_NOT_CONFIGURED_MSG,
};

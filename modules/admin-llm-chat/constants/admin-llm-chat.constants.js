'use strict';

const config = require('../../../config/config');

function envInt(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return parseInt(v, 10);
}

function envFloat(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return parseFloat(v);
}

function envBool(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

function defaultEnabled() {
  if (config.adminLlmChat?.enabled === true) return true;
  if (config.adminLlmChat?.enabled === false) return false;
  return ['local', 'development'].includes(process.env.NODE_ENV);
}

module.exports = {
  ENABLED: envBool('ADMIN_LLM_CHAT_ENABLED', defaultEnabled()),
  PROVIDER_OPENAI_ENABLED: envBool('ADMIN_LLM_CHAT_PROVIDER_OPENAI_ENABLED', true),
  PROVIDER_ANTHROPIC_ENABLED: envBool('ADMIN_LLM_CHAT_PROVIDER_ANTHROPIC_ENABLED', true),
  TOOL_QUERY_CLICKHOUSE_ENABLED: envBool('ADMIN_LLM_CHAT_TOOL_QUERY_CLICKHOUSE_ENABLED', true),

  MAX_ATTACHMENTS_PER_MESSAGE: envInt('ADMIN_LLM_CHAT_MAX_ATTACHMENTS', 10),
  MAX_FILE_SIZE_BYTES_IMAGE: envInt('ADMIN_LLM_CHAT_MAX_FILE_SIZE_IMAGE', 10 * 1024 * 1024),
  MAX_FILE_SIZE_BYTES_DOC: envInt('ADMIN_LLM_CHAT_MAX_FILE_SIZE_DOC', 25 * 1024 * 1024),
  MAX_RECENT_TURNS: envInt('ADMIN_LLM_CHAT_MAX_RECENT_TURNS', 40),
  MAX_TOOL_CALLS_PER_TURN: envInt('ADMIN_LLM_CHAT_MAX_TOOL_CALLS', 8),
  MAX_TOOL_RESULT_TOKENS: envInt('ADMIN_LLM_CHAT_MAX_TOOL_RESULT_TOKENS', 4000),
  STREAM_IDLE_TIMEOUT_MS: envInt('ADMIN_LLM_CHAT_STREAM_IDLE_TIMEOUT_MS', 30000),
  STREAM_TOTAL_TIMEOUT_MS: envInt('ADMIN_LLM_CHAT_STREAM_TOTAL_TIMEOUT_MS', 180000),
  MAX_CONCURRENT_STREAMS_PER_USER: envInt('ADMIN_LLM_CHAT_MAX_CONCURRENT_STREAMS', 3),
  USER_DAILY_TOKEN_BUDGET_IN: envInt('ADMIN_LLM_CHAT_DAILY_TOKEN_BUDGET_IN', 2000000),
  USER_DAILY_TOKEN_BUDGET_OUT: envInt('ADMIN_LLM_CHAT_DAILY_TOKEN_BUDGET_OUT', 500000),
  USER_DAILY_COST_USD_CAP: envFloat('ADMIN_LLM_CHAT_DAILY_COST_CAP', 25),
  CONVERSATION_TOKEN_CAP: envInt('ADMIN_LLM_CHAT_CONVERSATION_TOKEN_CAP', 150000),
  CH_QUERY_LIMIT_DEFAULT: envInt('ADMIN_LLM_CHAT_CH_LIMIT_DEFAULT', 1000),
  CH_QUERY_LIMIT_MAX: envInt('ADMIN_LLM_CHAT_CH_LIMIT_MAX', 10000),
  CH_MAX_EXECUTION_TIME_SEC: envInt('ADMIN_LLM_CHAT_CH_MAX_EXECUTION_TIME', 30),
  DELETE_GRACE_DAYS: envInt('ADMIN_LLM_CHAT_DELETE_GRACE_DAYS', 30),
  RETENTION_DAYS: envInt('ADMIN_LLM_CHAT_RETENTION_DAYS', 365),
  SSE_REPLAY_TTL_SEC: envInt('ADMIN_LLM_CHAT_SSE_REPLAY_TTL', 300),
  SSE_REPLAY_MAX_EVENTS: envInt('ADMIN_LLM_CHAT_SSE_REPLAY_MAX', 500),
  SSE_HEARTBEAT_MS: envInt('ADMIN_LLM_CHAT_SSE_HEARTBEAT_MS', 15000),

  REDIS_PREFIX: 'admin_llm_chat',
  PERMISSION_CODE: 'admin_llm_chat',
  DEFAULT_SYSTEM_PROMPT_VERSION: 'v1',
  DEFAULT_MODEL: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },

  DIGEST_CRON: process.env.ADMIN_LLM_CHAT_DIGEST_CRON || '0 8 * * *',
  DIGEST_TZ: process.env.ADMIN_LLM_CHAT_DIGEST_TZ || 'Asia/Kolkata',
  DIGEST_FALLBACK_MODEL: process.env.ADMIN_LLM_CHAT_DIGEST_FALLBACK_MODEL || 'gpt-4o',

  HMAC_SECRET: process.env.ADMIN_LLM_CHAT_DIGEST_HMAC_SECRET || config.internalAuth?.digestHmacSecret || '',
  HMAC_MAX_SKEW_SEC: envInt('ADMIN_LLM_CHAT_HMAC_MAX_SKEW', 60),

  CONTEXT_USAGE_WARN_PCT: envFloat('ADMIN_LLM_CHAT_CTX_WARN_PCT', 0.75),
  CONTEXT_USAGE_AUTO_PCT: envFloat('ADMIN_LLM_CHAT_CTX_AUTO_PCT', 0.85),
  SUMMARY_TARGET_TOKENS: envInt('ADMIN_LLM_CHAT_SUMMARY_TARGET_TOKENS', 1200),
  SUMMARY_KEEP_RECENT_TURNS: envInt('ADMIN_LLM_CHAT_SUMMARY_KEEP_RECENT', 6),
  SUMMARY_PER_USER_PER_MIN: envInt('ADMIN_LLM_CHAT_SUMMARY_RPM', 4),
  TITLE_PER_USER_PER_MIN: envInt('ADMIN_LLM_CHAT_TITLE_RPM', 10),
};

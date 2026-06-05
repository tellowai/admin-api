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

/** Env overrides config.adminLlmChat when set; otherwise use local.js / env.js value. */
function flagFromConfig(envKey, configValue, fallback) {
  const v = process.env[envKey];
  if (v !== undefined && v !== '') return v === 'true' || v === '1';
  if (configValue === true || configValue === false) return configValue;
  return fallback;
}

function widgetTypeFlag(widgetType, envKey, fallback) {
  const cfg = config.adminLlmChat?.widgets?.[widgetType];
  return flagFromConfig(envKey, cfg, fallback);
}

function memoryCfg() {
  return config.adminLlmChat?.memory || {};
}

/** Env overrides adminLlmChat.memory in local.js / env.js when set. */
function memoryBool(envKey, configKey, fallback) {
  return flagFromConfig(envKey, memoryCfg()[configKey], fallback);
}

function memoryInt(envKey, configKey, fallback) {
  const v = process.env[envKey];
  if (v !== undefined && v !== '') return parseInt(v, 10);
  const cfg = memoryCfg()[configKey];
  if (cfg !== undefined && cfg !== null && cfg !== '') return parseInt(cfg, 10);
  return fallback;
}

function memoryFloat(envKey, configKey, fallback) {
  const v = process.env[envKey];
  if (v !== undefined && v !== '') return parseFloat(v);
  const cfg = memoryCfg()[configKey];
  if (cfg !== undefined && cfg !== null && cfg !== '') return parseFloat(cfg);
  return fallback;
}

function memoryString(envKey, configKey, fallback) {
  const v = process.env[envKey];
  if (v !== undefined && v !== '') return v;
  const cfg = memoryCfg()[configKey];
  if (cfg !== undefined && cfg !== null && cfg !== '') return String(cfg);
  return fallback;
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
  TOOL_QUERY_MYSQL_ENABLED: envBool('ADMIN_LLM_CHAT_TOOL_QUERY_MYSQL_ENABLED', true),
  TOOL_RUN_ANALYSIS_CODE_ENABLED: envBool('ADMIN_LLM_CHAT_TOOL_RUN_ANALYSIS_CODE_ENABLED', true),
  TOOL_RENDER_WIDGET_ENABLED: flagFromConfig(
    'ADMIN_LLM_CHAT_TOOL_RENDER_WIDGET_ENABLED',
    config.adminLlmChat?.toolRenderWidgetEnabled,
    true,
  ),
  /** Per-widget rollout; set in adminLlmChat.widgets in local.js or via ADMIN_LLM_CHAT_WIDGET_* env. */
  WIDGET_TYPE_FLAGS: {
    kpi_cards: widgetTypeFlag('kpi_cards', 'ADMIN_LLM_CHAT_WIDGET_KPI_CARDS', true),
    data_table: widgetTypeFlag('data_table', 'ADMIN_LLM_CHAT_WIDGET_DATA_TABLE', true),
    line_chart: widgetTypeFlag('line_chart', 'ADMIN_LLM_CHAT_WIDGET_LINE_CHART', true),
    bar_chart: widgetTypeFlag('bar_chart', 'ADMIN_LLM_CHAT_WIDGET_BAR_CHART', true),
    pie_chart: widgetTypeFlag('pie_chart', 'ADMIN_LLM_CHAT_WIDGET_PIE_CHART', true),
    callout: widgetTypeFlag('callout', 'ADMIN_LLM_CHAT_WIDGET_CALLOUT', true),
    vega_lite_chart: widgetTypeFlag('vega_lite_chart', 'ADMIN_LLM_CHAT_WIDGET_VEGA_LITE', false),
  },
  ANALYSIS_CODE_TIMEOUT_MS: envInt('ADMIN_LLM_CHAT_ANALYSIS_CODE_TIMEOUT_MS', 3000),

  MAX_ATTACHMENTS_PER_MESSAGE: envInt('ADMIN_LLM_CHAT_MAX_ATTACHMENTS', 10),
  MAX_FILE_SIZE_BYTES_IMAGE: envInt('ADMIN_LLM_CHAT_MAX_FILE_SIZE_IMAGE', 10 * 1024 * 1024),
  MAX_FILE_SIZE_BYTES_DOC: envInt('ADMIN_LLM_CHAT_MAX_FILE_SIZE_DOC', 25 * 1024 * 1024),
  MAX_RECENT_TURNS: envInt('ADMIN_LLM_CHAT_MAX_RECENT_TURNS', 40),
  MAX_TOOL_CALLS_PER_TURN: envInt(
    'ADMIN_LLM_CHAT_MAX_TOOL_CALLS',
    Number.isFinite(config.adminLlmChat?.maxToolCallsPerTurn)
      ? config.adminLlmChat.maxToolCallsPerTurn
      : 24,
  ),
  MAX_TOOL_RESULT_TOKENS: envInt('ADMIN_LLM_CHAT_MAX_TOOL_RESULT_TOKENS', 4000),
  STREAM_IDLE_TIMEOUT_MS: envInt('ADMIN_LLM_CHAT_STREAM_IDLE_TIMEOUT_MS', 30000),
  STREAM_TOTAL_TIMEOUT_MS: envInt('ADMIN_LLM_CHAT_STREAM_TOTAL_TIMEOUT_MS', 180000),
  /** Max parallel AI responses (streams) per admin across all chats. */
  MAX_CONCURRENT_STREAMS_PER_USER: envInt(
    'ADMIN_LLM_CHAT_MAX_CONCURRENT_STREAMS',
    Number.isFinite(config.adminLlmChat?.maxConcurrentStreamsPerUser)
      ? config.adminLlmChat.maxConcurrentStreamsPerUser
      : 5,
  ),
  USER_DAILY_TOKEN_BUDGET_IN: envInt('ADMIN_LLM_CHAT_DAILY_TOKEN_BUDGET_IN', 2000000),
  USER_DAILY_TOKEN_BUDGET_OUT: envInt('ADMIN_LLM_CHAT_DAILY_TOKEN_BUDGET_OUT', 500000),
  USER_DAILY_COST_USD_CAP: envFloat('ADMIN_LLM_CHAT_DAILY_COST_CAP', 25),
  CONVERSATION_TOKEN_CAP: envInt('ADMIN_LLM_CHAT_CONVERSATION_TOKEN_CAP', 150000),
  CH_QUERY_LIMIT_DEFAULT: envInt('ADMIN_LLM_CHAT_CH_LIMIT_DEFAULT', 1000),
  CH_QUERY_LIMIT_MAX: envInt('ADMIN_LLM_CHAT_CH_LIMIT_MAX', 10000),
  /** Lookback window for get_table_date_bounds (bounded min/max, not full table scan). */
  CH_DATE_BOUNDS_LOOKBACK_DAYS: envInt('ADMIN_LLM_CHAT_CH_DATE_BOUNDS_LOOKBACK_DAYS', 730),
  CH_MAX_EXECUTION_TIME_SEC: envInt('ADMIN_LLM_CHAT_CH_MAX_EXECUTION_TIME', 30),
  MYSQL_QUERY_LIMIT_DEFAULT: envInt('ADMIN_LLM_CHAT_MYSQL_LIMIT_DEFAULT', 1000),
  MYSQL_QUERY_LIMIT_MAX: envInt('ADMIN_LLM_CHAT_MYSQL_LIMIT_MAX', 10000),
  DELETE_GRACE_DAYS: envInt('ADMIN_LLM_CHAT_DELETE_GRACE_DAYS', 30),
  RETENTION_DAYS: envInt('ADMIN_LLM_CHAT_RETENTION_DAYS', 365),
  SSE_REPLAY_TTL_SEC: envInt('ADMIN_LLM_CHAT_SSE_REPLAY_TTL', 300),
  SSE_REPLAY_MAX_EVENTS: envInt('ADMIN_LLM_CHAT_SSE_REPLAY_MAX', 500),
  SSE_HEARTBEAT_MS: envInt('ADMIN_LLM_CHAT_SSE_HEARTBEAT_MS', 15000),

  /**
   * Brand/company name used across the chat (business context, system prompt,
   * refusal message). Switch per deployment like the nav logo — set
   * ADMIN_LLM_CHAT_COMPANY_NAME (or adminLlmChat.companyName in local.js),
   * e.g. "Kriya AI" vs the default "Tellow AI".
   */
  COMPANY_NAME: process.env.ADMIN_LLM_CHAT_COMPANY_NAME
    || config.adminLlmChat?.companyName
    || 'Tellow AI',

  REDIS_PREFIX: 'admin_llm_chat',
  PERMISSION_CODE: 'admin_llm_chat',
  DEFAULT_SYSTEM_PROMPT_VERSION: 'v1',
  DEFAULT_MODEL: { provider: 'openai', modelId: 'gpt-5.5' },

  DIGEST_CRON: process.env.ADMIN_LLM_CHAT_DIGEST_CRON || '0 8 * * *',
  DIGEST_TZ: process.env.ADMIN_LLM_CHAT_DIGEST_TZ || 'Asia/Kolkata',
  DIGEST_FALLBACK_MODEL: process.env.ADMIN_LLM_CHAT_DIGEST_FALLBACK_MODEL || 'gpt-4o',
  DIGEST_SYSTEM_USER_ID: 'system-digest',
  /** Section headings for daily digest output (order matters). */
  DIGEST_OUTPUT_SECTIONS: 'TL;DR (3 bullets), Numbers, Insights, Anomalies, Suggested actions',
  DIGEST_SUMMARY_NUDGE:
    'Based on the tool results above, write the daily digest now. Do not call more tools. '
    + 'Use these sections in order: **TL;DR** (3 bullets), **Numbers**, **Insights**, **Anomalies**, **Suggested actions**. '
    + 'Business language only — no table names, schemas, or tool narration. '
    + 'Insights: patterns, drivers, and what changed vs prior periods. Anomalies: surprises and underperformance. '
    + 'Suggested actions only if off-track or clear levers; omit if on par/growing. '
    + 'If blocked, say what is missing in data, not how many queries you ran.',

  HMAC_SECRET: process.env.ADMIN_LLM_CHAT_DIGEST_HMAC_SECRET || config.internalAuth?.digestHmacSecret || '',
  HMAC_MAX_SKEW_SEC: envInt('ADMIN_LLM_CHAT_HMAC_MAX_SKEW', 60),

  CONTEXT_USAGE_WARN_PCT: envFloat('ADMIN_LLM_CHAT_CTX_WARN_PCT', 0.75),
  CONTEXT_USAGE_AUTO_PCT: envFloat('ADMIN_LLM_CHAT_CTX_AUTO_PCT', 0.85),
  SUMMARY_TARGET_TOKENS: envInt('ADMIN_LLM_CHAT_SUMMARY_TARGET_TOKENS', 1200),
  SUMMARY_KEEP_RECENT_TURNS: envInt('ADMIN_LLM_CHAT_SUMMARY_KEEP_RECENT', 6),
  SUMMARY_PER_USER_PER_MIN: envInt('ADMIN_LLM_CHAT_SUMMARY_RPM', 4),
  TITLE_PER_USER_PER_MIN: envInt('ADMIN_LLM_CHAT_TITLE_RPM', 10),

  /** Messages returned per page in GET conversation (matches admin templates list page size). */
  MESSAGES_PAGE_SIZE: envInt('ADMIN_LLM_CHAT_MESSAGES_PAGE_SIZE', 10),
  MESSAGES_PAGE_SIZE_MAX: envInt('ADMIN_LLM_CHAT_MESSAGES_PAGE_SIZE_MAX', 50),

  /** Public R2 prefix: admin-llm-chat/attachments/{conversationId}/{attachmentId}.{ext} */
  ATTACHMENT_STORAGE_PREFIX: 'admin-llm-chat/attachments/',

  /**
   * Long-term memory — set in config/env/local.js under adminLlmChat.memory.
   * Env vars (ADMIN_LLM_CHAT_MEMORY_*) still override when set.
   */
  MEMORY_RETRIEVAL_ENABLED: memoryBool('ADMIN_LLM_CHAT_MEMORY_RETRIEVAL_ENABLED', 'retrievalEnabled', true),
  MEMORY_EMBEDDING_ENABLED: memoryBool('ADMIN_LLM_CHAT_MEMORY_EMBEDDING_ENABLED', 'embeddingEnabled', true),
  MEMORY_EMBEDDING_MODEL: memoryString('ADMIN_LLM_CHAT_MEMORY_EMBEDDING_MODEL', 'embeddingModel', 'text-embedding-3-small'),
  MEMORY_BACKGROUND_ENABLED: memoryBool('ADMIN_LLM_CHAT_MEMORY_BACKGROUND_ENABLED', 'backgroundEnabled', true),
  MEMORY_EXTRACTION_ENABLED: memoryBool('ADMIN_LLM_CHAT_MEMORY_EXTRACTION_ENABLED', 'extractionEnabled', true),
  MEMORY_EPISODIC_ENABLED: memoryBool('ADMIN_LLM_CHAT_MEMORY_EPISODIC_ENABLED', 'episodicEnabled', true),
  MEMORY_PROFILE_AUTO_UPDATE: memoryBool('ADMIN_LLM_CHAT_MEMORY_PROFILE_AUTO_UPDATE', 'profileAutoUpdate', true),
  MEMORY_EXTRACT_WHEN_REMEMBER_USED: memoryBool('ADMIN_LLM_CHAT_MEMORY_EXTRACT_WHEN_REMEMBER_USED', 'extractWhenRememberUsed', false),
  MEMORY_RETRIEVAL_TOP_K: memoryInt('ADMIN_LLM_CHAT_MEMORY_TOP_K', 'retrievalTopK', 8),
  MEMORY_EPISODIC_TOP_K: memoryInt('ADMIN_LLM_CHAT_MEMORY_EPISODIC_TOP_K', 'episodicTopK', 3),
  MEMORY_EPISODIC_CANDIDATE_LIMIT: memoryInt('ADMIN_LLM_CHAT_MEMORY_EPISODIC_CANDIDATES', 'episodicCandidateLimit', 30),
  MEMORY_RETRIEVAL_MIN_SCORE: memoryFloat('ADMIN_LLM_CHAT_MEMORY_MIN_SCORE', 'retrievalMinScore', 0.12),
  MEMORY_RETRIEVAL_SEMANTIC_WEIGHT: memoryFloat('ADMIN_LLM_CHAT_MEMORY_SEMANTIC_WEIGHT', 'retrievalSemanticWeight', 0.7),
  MEMORY_RETRIEVAL_KEYWORD_WEIGHT: memoryFloat('ADMIN_LLM_CHAT_MEMORY_KEYWORD_WEIGHT', 'retrievalKeywordWeight', 0.3),
  MEMORY_FULL_DUMP_THRESHOLD: memoryInt('ADMIN_LLM_CHAT_MEMORY_FULL_DUMP_THRESHOLD', 'fullDumpThreshold', 12),
  MEMORY_FULL_DUMP_MAX: memoryInt('ADMIN_LLM_CHAT_MEMORY_FULL_DUMP_MAX', 'fullDumpMax', 20),
  MEMORY_EXTRACTION_PER_USER_PER_MIN: memoryInt('ADMIN_LLM_CHAT_MEMORY_EXTRACT_RPM', 'extractionPerUserPerMin', 8),
  MEMORY_EPISODIC_PER_USER_PER_MIN: memoryInt('ADMIN_LLM_CHAT_MEMORY_EPISODIC_RPM', 'episodicPerUserPerMin', 4),
  MEMORY_EXTRACTION_MAX_PER_TURN: memoryInt('ADMIN_LLM_CHAT_MEMORY_EXTRACT_MAX', 'extractionMaxPerTurn', 5),
  MEMORY_DEFAULT_TTL_DAYS: memoryInt('ADMIN_LLM_CHAT_MEMORY_TTL_DAYS', 'defaultTtlDays', 0),
};

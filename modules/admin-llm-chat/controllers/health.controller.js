'use strict';

const HTTP = require('../../core/controllers/httpcodes.server.controller').CODES;
const CONSTANTS = require('../constants/admin-llm-chat.constants');
const streamRegistry = require('../services/stream.registry');
const modelsRegistry = require('../services/models.registry.service');
const circuitBreaker = require('../services/circuit-breaker.util');
const schemaCache = require('../services/schema.cache.service');
const { getEnabledWidgets } = require('../constants/widgets');

exports.health = async (req, res) => {
  let redisStatus = 'degraded';
  try {
    const { redisClient } = require('../../../config/lib/redis');
    redisStatus = redisClient?.isReady ? 'ok' : 'degraded';
  } catch (_e) { /* ignore */ }

  const summarizer = modelsRegistry.getSummarizerModel();
  let clickhouseStatus = 'ok';
  let clickhouseDetail = null;
  try {
    const { pingClickHouseReadonly, isClickHouseReadonlyConfigured } = require('../../../config/lib/clickhouse.readonly');
    if (!isClickHouseReadonlyConfigured()) {
      clickhouseStatus = 'not_configured';
      clickhouseDetail = 'adminLlmChatReadonly missing — set in config/env or ADMIN_LLM_CHAT_CH_* env vars';
    } else {
      const ping = await pingClickHouseReadonly();
      clickhouseStatus = ping.ok ? 'ok' : 'unreachable';
      if (!ping.ok) clickhouseDetail = ping.message || ping.reason;
    }
  } catch (e) {
    clickhouseStatus = 'error';
    clickhouseDetail = e.message;
  }

  return res.status(HTTP.OK).json({
    data: {
      enabled: CONSTANTS.ENABLED,
      draining: streamRegistry.isDraining(),
      activeStreams: streamRegistry.getActiveCount(),
      providers: {
        openai: CONSTANTS.PROVIDER_OPENAI_ENABLED ? 'ok' : 'disabled',
        anthropic: CONSTANTS.PROVIDER_ANTHROPIC_ENABLED ? 'ok' : 'disabled',
      },
      summarizer: summarizer
        ? { status: 'ok', id: summarizer.id, provider: summarizer.provider }
        : { status: 'degraded', reason: 'not_configured' },
      circuitBreakers: {
        summary: circuitBreaker.isOpen('admin_llm_chat_summary') ? 'open' : 'closed',
        title: circuitBreaker.isOpen('admin_llm_chat_title') ? 'open' : 'closed',
      },
      tools: {
        query_clickhouse: CONSTANTS.TOOL_QUERY_CLICKHOUSE_ENABLED ? 'ok' : 'disabled',
        run_analysis_code: CONSTANTS.TOOL_RUN_ANALYSIS_CODE_ENABLED ? 'ok' : 'disabled',
        render_widget: CONSTANTS.TOOL_RENDER_WIDGET_ENABLED ? 'ok' : 'disabled',
      },
      widgets: {
        enabled: getEnabledWidgets().map((w) => w.type),
        count: getEnabledWidgets().length,
      },
      clickhouseReadonly: clickhouseStatus,
      clickhouseReadonlyDetail: clickhouseDetail,
      clickhouseSchemaVersion: schemaCache.SCHEMA_VERSION,
      redis: redisStatus,
      kafka: global.kafkaProducer ? 'ok' : 'degraded',
    },
  });
};

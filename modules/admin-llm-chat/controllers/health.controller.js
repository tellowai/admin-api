'use strict';

const HTTP = require('../../core/controllers/httpcodes.server.controller').CODES;
const CONSTANTS = require('../constants/admin-llm-chat.constants');
const streamRegistry = require('../services/stream.registry');
const modelsRegistry = require('../services/models.registry.service');
const circuitBreaker = require('../services/circuit-breaker.util');
const schemaCache = require('../services/schema.cache.service');

exports.health = async (req, res) => {
  let redisStatus = 'degraded';
  try {
    const { redisClient } = require('../../../config/lib/redis');
    redisStatus = redisClient?.isReady ? 'ok' : 'degraded';
  } catch (_e) { /* ignore */ }

  const summarizer = modelsRegistry.getSummarizerModel();
  let clickhouseStatus = 'ok';
  try {
    const { readonlyClickhouse } = require('../../../config/lib/clickhouse.readonly');
    clickhouseStatus = readonlyClickhouse ? 'ok' : 'degraded';
  } catch (_e) {
    clickhouseStatus = 'degraded';
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
      },
      clickhouseReadonly: clickhouseStatus,
      clickhouseSchemaVersion: schemaCache.SCHEMA_VERSION,
      redis: redisStatus,
      kafka: global.kafkaProducer ? 'ok' : 'degraded',
    },
  });
};

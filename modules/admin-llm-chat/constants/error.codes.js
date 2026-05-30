'use strict';

const HTTP = require('../../core/controllers/httpcodes.server.controller').CODES;

module.exports = {
  ADMIN_LLM_CHAT_DISABLED: { code: 'ADMIN_LLM_CHAT_DISABLED', httpStatus: HTTP.SERVICE_UNAVAILABLE, userMessage: 'admin_llm_chat:DISABLED', retryable: false, category: 'server' },
  FORBIDDEN: { code: 'FORBIDDEN', httpStatus: HTTP.FORBIDDEN, userMessage: 'admin_llm_chat:FORBIDDEN', retryable: false, category: 'auth' },
  CONVERSATION_NOT_FOUND: { code: 'CONVERSATION_NOT_FOUND', httpStatus: HTTP.NOT_FOUND, userMessage: 'admin_llm_chat:CONVERSATION_NOT_FOUND', retryable: false, category: 'validation' },
  CONVERSATION_GONE: { code: 'CONVERSATION_GONE', httpStatus: HTTP.GONE, userMessage: 'admin_llm_chat:CONVERSATION_GONE', retryable: false, category: 'validation' },
  UNSUPPORTED_MODEL: { code: 'UNSUPPORTED_MODEL', httpStatus: HTTP.BAD_REQUEST, userMessage: 'admin_llm_chat:UNSUPPORTED_MODEL', retryable: false, category: 'validation' },
  STREAM_IN_PROGRESS: { code: 'STREAM_IN_PROGRESS', httpStatus: HTTP.CONFLICT, userMessage: 'admin_llm_chat:STREAM_IN_PROGRESS', retryable: true, category: 'validation' },
  TOO_MANY_CONCURRENT_STREAMS: {
    code: 'TOO_MANY_CONCURRENT_STREAMS',
    httpStatus: HTTP.TOO_MANY_REQUESTS,
    userMessage: 'admin_llm_chat:TOO_MANY_CONCURRENT_STREAMS',
    retryable: true,
    category: 'validation',
  },
  PAYLOAD_TOO_LARGE: { code: 'PAYLOAD_TOO_LARGE', httpStatus: HTTP.REQUEST_ENTITY_TOO_LARGE, userMessage: 'admin_llm_chat:PAYLOAD_TOO_LARGE', retryable: false, category: 'validation' },
  MODEL_NO_VISION: { code: 'MODEL_NO_VISION', httpStatus: HTTP.BAD_REQUEST, userMessage: 'admin_llm_chat:MODEL_NO_VISION', retryable: false, category: 'validation' },
  BUDGET_EXCEEDED: { code: 'BUDGET_EXCEEDED', httpStatus: HTTP.TOO_MANY_REQUESTS, userMessage: 'admin_llm_chat:BUDGET_EXCEEDED', retryable: false, category: 'budget' },
  TOO_MANY_ATTACHMENTS: { code: 'TOO_MANY_ATTACHMENTS', httpStatus: HTTP.BAD_REQUEST, userMessage: 'admin_llm_chat:TOO_MANY_ATTACHMENTS', retryable: false, category: 'validation' },
  FILE_TOO_LARGE: { code: 'FILE_TOO_LARGE', httpStatus: HTTP.REQUEST_ENTITY_TOO_LARGE, userMessage: 'admin_llm_chat:FILE_TOO_LARGE', retryable: false, category: 'validation' },
  PROVIDER_AUTH: { code: 'PROVIDER_AUTH', httpStatus: HTTP.SERVICE_UNAVAILABLE, userMessage: 'admin_llm_chat:PROVIDER_AUTH', retryable: true, category: 'provider' },
  PROVIDER_RATELIMIT: { code: 'PROVIDER_RATELIMIT', httpStatus: HTTP.TOO_MANY_REQUESTS, userMessage: 'admin_llm_chat:PROVIDER_RATELIMIT', retryable: true, category: 'provider' },
  PROVIDER_IDLE_TIMEOUT: { code: 'PROVIDER_IDLE_TIMEOUT', httpStatus: HTTP.GATEWAY_TIMEOUT, userMessage: 'admin_llm_chat:PROVIDER_IDLE_TIMEOUT', retryable: true, category: 'provider' },
  SERVER_DRAINING: { code: 'SERVER_DRAINING', httpStatus: HTTP.SERVICE_UNAVAILABLE, userMessage: 'admin_llm_chat:SERVER_DRAINING', retryable: true, category: 'server' },
  SERVER_SHUTDOWN: { code: 'SERVER_SHUTDOWN', httpStatus: HTTP.SERVICE_UNAVAILABLE, userMessage: 'admin_llm_chat:SERVER_SHUTDOWN', retryable: true, category: 'server' },
  DIGEST_ALREADY_SENT: { code: 'DIGEST_ALREADY_SENT', httpStatus: HTTP.CONFLICT, userMessage: 'admin_llm_chat:DIGEST_ALREADY_SENT', retryable: false, category: 'validation' },
  HMAC_INVALID: { code: 'HMAC_INVALID', httpStatus: HTTP.UNAUTHORIZED, userMessage: 'admin_llm_chat:HMAC_INVALID', retryable: false, category: 'auth' },
  QUERY_NOT_ALLOWED: { code: 'QUERY_NOT_ALLOWED', httpStatus: HTTP.BAD_REQUEST, userMessage: 'admin_llm_chat:QUERY_NOT_ALLOWED', retryable: false, category: 'tool' },
  TABLE_NOT_ALLOWED: { code: 'TABLE_NOT_ALLOWED', httpStatus: HTTP.BAD_REQUEST, userMessage: 'admin_llm_chat:TABLE_NOT_ALLOWED', retryable: false, category: 'tool' },
  JOIN_NOT_ALLOWED: { code: 'JOIN_NOT_ALLOWED', httpStatus: HTTP.BAD_REQUEST, userMessage: 'admin_llm_chat:JOIN_NOT_ALLOWED', retryable: false, category: 'tool' },
  DATE_PREDICATE_REQUIRED: { code: 'DATE_PREDICATE_REQUIRED', httpStatus: HTTP.BAD_REQUEST, userMessage: 'admin_llm_chat:DATE_PREDICATE_REQUIRED', retryable: false, category: 'tool' },
  QUERY_TIMEOUT: { code: 'QUERY_TIMEOUT', httpStatus: HTTP.GATEWAY_TIMEOUT, userMessage: 'admin_llm_chat:QUERY_TIMEOUT', retryable: true, category: 'tool' },
  CH_UNAVAILABLE: { code: 'CH_UNAVAILABLE', httpStatus: HTTP.SERVICE_UNAVAILABLE, userMessage: 'admin_llm_chat:CH_UNAVAILABLE', retryable: true, category: 'tool' },
};

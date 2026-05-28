'use strict';

function extractJsonMessage(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const start = raw.indexOf('{');
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(start));
    return parsed?.error?.message || parsed?.message || null;
  } catch (_e) {
    return null;
  }
}

function mapKnownProviderMessage(message) {
  const m = String(message || '').trim();
  if (!m) return null;

  if (/credit balance is too low/i.test(m)) {
    return {
      code: 'PROVIDER_BILLING',
      message: 'Anthropic API credits are exhausted. Add credits in Anthropic Plans & Billing, then try again.',
      retryable: false,
    };
  }
  if (/insufficient_quota|billing|exceeded your current quota/i.test(m)) {
    return {
      code: 'PROVIDER_BILLING',
      message: 'OpenAI API quota or billing limit reached. Check your OpenAI account billing settings.',
      retryable: false,
    };
  }
  if (/invalid.*api.*key|authentication|unauthorized/i.test(m)) {
    return {
      code: 'PROVIDER_AUTH',
      message: 'Provider API key is invalid or missing. Check LLM provider keys in admin-api configuration.',
      retryable: false,
    };
  }
  if (/rate limit|too many requests|429/i.test(m)) {
    return {
      code: 'PROVIDER_RATELIMIT',
      message: 'The model provider is rate-limiting requests. Please wait a moment and try again.',
      retryable: true,
    };
  }
  if (/not_found_error|model:\s*claude|model not found|404/i.test(m)) {
    return {
      code: 'MODEL_NOT_AVAILABLE',
      message: 'That model id is not available from the provider anymore. Switch to Claude Sonnet 4.6 (or another model) in the composer.',
      retryable: false,
    };
  }
  if (/terminated|econnreset|socket hang up/i.test(m)) {
    return {
      code: 'STREAM_DISCONNECTED',
      message: 'The model stream disconnected (often during long tool runs). Retry your message; partial steps may be saved above.',
      retryable: true,
    };
  }
  return null;
}

function trimForUi(message, maxLen = 280) {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

/**
 * Turn provider SDK/HTTP errors into a short user-facing SSE/API payload.
 */
function formatProviderError(error, fallbackCode = 'PROVIDER_ERROR') {
  const raw = error?.message || String(error || 'Unknown provider error');
  const nested = extractJsonMessage(raw);
  const known = mapKnownProviderMessage(nested || raw);
  if (known) return known;

  const cleaned = trimForUi(nested || raw.replace(/^\d{3}\s*/, ''));
  return {
    code: fallbackCode,
    message: cleaned || 'The model provider returned an error. Please try again.',
    retryable: true,
  };
}

module.exports = { formatProviderError, extractJsonMessage, mapKnownProviderMessage };

'use strict';

/** OpenAI reasoning / GPT-5+ models reject max_tokens; use max_completion_tokens. */
function usesMaxCompletionTokens(model) {
  const m = String(model || '').toLowerCase();
  if (/^o[0-9]/.test(m)) return true;
  if (/^gpt-5/.test(m)) return true;
  return false;
}

function buildOpenaiTokenLimitParams(model, maxTokens, defaultMax = 4096) {
  const limit = maxTokens ?? defaultMax;
  if (usesMaxCompletionTokens(model)) {
    return { max_completion_tokens: limit };
  }
  return { max_tokens: limit };
}

/** GPT-5 / o-series only accept API default temperature — omit the param. */
function buildOpenaiTemperatureParam(model, temperature) {
  if (usesMaxCompletionTokens(model)) return {};
  return { temperature: temperature ?? 0.2 };
}

module.exports = {
  usesMaxCompletionTokens,
  buildOpenaiTokenLimitParams,
  buildOpenaiTemperatureParam,
};

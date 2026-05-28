'use strict';

function resolveAnthropicApiKey(config = {}) {
  let apiKey = config.llmProviders?.anthropic?.apiKey;
  if (!apiKey) {
    try {
      const appConfig = require('../../../../config/config');
      apiKey = appConfig.llmProviders?.anthropic?.apiKey;
    } catch (_e) {
      /* config not loaded */
    }
  }
  return apiKey || process.env.ANTHROPIC_API_KEY || null;
}

class AnthropicWrapper {
  static async create(config = {}) {
    const Anthropic = require('@anthropic-ai/sdk');
    const apiKey = resolveAnthropicApiKey(config);
    if (!apiKey) {
      throw new Error('Anthropic API key not configured (llmProviders.anthropic.apiKey or ANTHROPIC_API_KEY)');
    }
    return new Anthropic({ apiKey });
  }
}

module.exports = AnthropicWrapper;
module.exports.resolveAnthropicApiKey = resolveAnthropicApiKey;

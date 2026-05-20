'use strict';

class AnthropicWrapper {
  static async create(config) {
    const Anthropic = require('@anthropic-ai/sdk');
    return new Anthropic({ apiKey: config.llmProviders?.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY });
  }
}

module.exports = AnthropicWrapper;

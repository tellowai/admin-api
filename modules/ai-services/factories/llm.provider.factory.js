'use strict';

const OpenAIProvider = require('../providers/openai/openai.provider.js');
const AnthropicProvider = require('../providers/anthropic/anthropic.provider.js');
const config = require('../../../config/config');

class LLMProviderFactory {
  static async createProvider(providerName) {
    switch (providerName.toLowerCase()) {
      case 'openai': {
        const provider = new OpenAIProvider(config);
        await provider.initialize();
        return provider;
      }
      case 'anthropic': {
        const provider = new AnthropicProvider(config);
        await provider.initialize();
        return provider;
      }
      default:
        throw new Error(`Unsupported AI provider: ${providerName}`);
    }
  }
}

module.exports = LLMProviderFactory; 
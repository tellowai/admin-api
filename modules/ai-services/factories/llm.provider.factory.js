'use strict';

const OpenAIProvider = require('../providers/openai/openai.provider.js');
// import { AnthropicProvider } from '../providers/anthropic/anthropic.provider.js';
const config = require('../../../config/config');

class LLMProviderFactory {
  static async createProvider(providerName) {
    switch (providerName.toLowerCase()) {
      case 'openai': {
        const provider = new OpenAIProvider(config);
        await provider.initialize(); // Ensure initialization is complete
        return provider;
      }
      case 'anthropic':
        throw new Error(`Unsupported AI provider: ${providerName}`);
        // return new AnthropicProvider(config);
      default:
        throw new Error(`Unsupported AI provider: ${providerName}`);
    }
  }
}

module.exports = LLMProviderFactory; 
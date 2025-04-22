'use strict';

class OpenAIWrapper {
  static async create(config) {
    const openai = await import('openai');
    return new openai.default({ apiKey: config.llmProviders.openai.apiKey });
  }

  static async getZodResponseFormat() {
    const helpers = await import('openai/helpers/zod');
    return helpers.zodResponseFormat;
  }
}

module.exports = OpenAIWrapper; 
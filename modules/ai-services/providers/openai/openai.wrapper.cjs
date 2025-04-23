'use strict';

class OpenAIWrapper {
  static async create(config) {
    const openai = await import('openai');
    return new openai.default({ apiKey: config.llmProviders.openai.apiKey });
  }

  static async getZodResponseFormat() {
    // Return a simple function that creates a JSON object format
    return () => ({ type: "json_object" });
  }
}

module.exports = OpenAIWrapper; 
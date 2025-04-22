'use strict';

class BaseLLMProvider {
  constructor(config) {
    if (this.constructor === BaseLLMProvider) {
      throw new Error("Abstract class 'BaseLLMProvider' cannot be instantiated");
    }
    this.config = config;
  }

  async createChatCompletion({ messages, responseFormat }) {
    throw new Error("Method 'createChatCompletion' must be implemented");
  }

  async createMultiModalCompletion({ messages, responseFormat, images }) {
    throw new Error("Method 'createMultiModalCompletion' must be implemented");
  }

  _calculateMetrics(response, startTime, messages, activeModel, isMultiModal = false) {
    throw new Error("Method '_calculateMetrics' must be implemented");
  }

  _calculateFailedMetrics(startTime, messages, activeModel, error, isMultiModal = false) {
    throw new Error("Method '_calculateFailedMetrics' must be implemented");
  }
}

module.exports = BaseLLMProvider; 
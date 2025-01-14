'use strict';

class BaseAIProvider {
  constructor(config) {
    if (this.constructor === BaseAIProvider) {
      throw new Error("Abstract class 'BaseAIProvider' cannot be instantiated");
    }
  }

  // Model Training/Tuning
  async tuneModelWithPhotos(modelName, images, options = {}) {
    throw new Error("Method 'tuneModel' must be implemented");
  }

  async getModelStatus(modelName, tuningId) {
    throw new Error("Method 'getModelStatus' must be implemented");
  }

  async getModelResults(modelName, tuningId) {
    throw new Error("Method 'getModelResults' must be implemented");
  }

  // Image Generation
  async generateImage(prompt, options = {}) {
    throw new Error("Method 'generateImage' must be implemented");
  }

  // Video Generation
  async generateVideo(prompt, options = {}) {
    throw new Error("Method 'generateVideo' must be implemented");
  }

  // Audio Generation
  async generateAudio(prompt, options = {}) {
    throw new Error("Method 'generateAudio' must be implemented");
  }
}

module.exports = BaseAIProvider; 
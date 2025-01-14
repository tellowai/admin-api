'use strict';

const FalAIProvider = require('../providers/fal/fal.provider');
const RunwayProvider = require('../providers/fal/fal.provider');
const ElevenLabsProvider = require('../providers/fal/fal.provider');
const config = require('../../../config/config');

class AIServicesProviderFactory {
  static async createProvider(serviceType, providerName) {

    const serviceConfig = config.aiServices[serviceType];
    if (!serviceConfig) {
      throw new Error(`Unsupported service type: ${serviceType}`);
    }

    // If no specific provider requested, use the active one
    const provider = providerName || serviceConfig.active;
    const providerConfig = serviceConfig.providers[provider];

    if (!providerConfig) {
      throw new Error(`Unsupported provider ${provider} for service ${serviceType}`);
    }

    switch (provider) {
      case 'fal':
        return new FalAIProvider(providerConfig);
      case 'runway':
        return new RunwayProvider(providerConfig);
      case 'elevenlabs':
        return new ElevenLabsProvider(providerConfig);
      default:
        throw new Error(`Provider ${provider} not implemented for service ${serviceType}`);
    }
  }
}

module.exports = AIServicesProviderFactory; 
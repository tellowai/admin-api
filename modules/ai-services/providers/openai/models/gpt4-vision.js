'use strict';

module.exports = {
  name: 'gpt-4o',
  provider: 'openai',
  capabilities: ['text', 'vision'],
  maxTokens: 4096,
  costs: {
    inputCostPerToken: 0.0000001500,
    outputCostPerToken: 0.0000006000
  }
}; 
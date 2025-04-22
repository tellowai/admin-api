'use strict';

module.exports = {
  name: 'gpt-4-turbo',
  provider: 'openai',
  capabilities: ['text'],
  maxTokens: 8192,
  costs: {
    inputCostPerToken: 0.0000001500,
    outputCostPerToken: 0.0000006000
  }
}; 
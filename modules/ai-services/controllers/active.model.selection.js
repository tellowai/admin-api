'use strict';

const config = require('../../../config/config');
const gpt4 = require('../providers/openai/models/gpt4');
const gpt4Vision = require('../providers/openai/models/gpt4-vision');
// const claude2 = require('../providers/anthropic/models/claude2');

const MODELS = [gpt4Vision, gpt4];
let activeModel = MODELS[0];

const models = {
  'gpt-4-turbo': gpt4,
  'gpt-4o': gpt4Vision
};

async function getActiveModelData(modelName = 'gpt-4-turbo') {
  if (modelName && models[modelName]) {
    return models[modelName];
  }

  return models['gpt-4-turbo'];
}

function setActiveModel(modelName) {
  const model = MODELS.find(m => m.name === modelName);
  if (!model) {
    throw new Error(`Invalid model name: ${modelName}`);
  }

  activeModel = model;
}

module.exports = {
  getActiveModelData,
  setActiveModel
};
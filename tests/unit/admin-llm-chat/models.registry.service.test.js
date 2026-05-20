'use strict';

const path = require('path');
const assert = require('assert');
const registry = require('../../../modules/admin-llm-chat/services/models.registry.service');

describe('models.registry.service', () => {
  before(() => {
    registry.invalidateCache();
  });

  it('normalizes minimal entries with provider defaults', () => {
    const entry = registry.normalizeEntry(
      { modelId: 'gpt-4.1', provider: 'openai', name: 'GPT-4.1' },
      {
        openai: { contextWindow: 128000, maxOutputTokens: 8192, supportsVision: true, supportsTools: true },
      },
    );
    assert.strictEqual(entry.id, 'gpt-4.1');
    assert.strictEqual(entry.provider, 'openai');
    assert.strictEqual(entry.displayName, 'GPT-4.1');
    assert.strictEqual(entry.contextWindow, 128000);
    assert.strictEqual(entry.supportsTools, true);
  });

  it('loads models from models.json', () => {
    const models = registry.getAllModels();
    assert.ok(models.length >= 2);
    assert.ok(models.some((m) => m.provider === 'anthropic'));
    assert.ok(models.some((m) => m.provider === 'openai'));
    assert.strictEqual(registry.resolveModelsPath(), path.join(
      __dirname,
      '../../../modules/admin-llm-chat/constants/models.json',
    ));
  });

  it('resolves default model from json', () => {
    const def = registry.getDefaultModel();
    assert.ok(def);
    assert.ok(def.id);
    assert.ok(['openai', 'anthropic'].includes(def.provider));
  });
});

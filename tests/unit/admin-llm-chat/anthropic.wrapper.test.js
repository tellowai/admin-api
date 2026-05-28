'use strict';

const { expect } = require('chai');
const { resolveAnthropicApiKey } = require('../../../modules/ai-services/providers/anthropic/anthropic.wrapper.cjs');

describe('anthropic.wrapper resolveAnthropicApiKey', () => {
  it('reads apiKey from app config when caller passes empty config', () => {
    const config = require('../../../config/config');
    const fromConfig = config.llmProviders?.anthropic?.apiKey;
    if (!fromConfig) {
      this.skip();
      return;
    }
    expect(resolveAnthropicApiKey({})).to.equal(fromConfig);
  });

  it('prefers explicit config over app config', () => {
    expect(resolveAnthropicApiKey({
      llmProviders: { anthropic: { apiKey: 'explicit-key' } },
    })).to.equal('explicit-key');
  });
});

'use strict';

const { expect } = require('chai');
const {
  usesMaxCompletionTokens,
  buildOpenaiTokenLimitParams,
  buildOpenaiTemperatureParam,
} = require('../../../modules/ai-services/utils/openai.token-limit');

describe('openai.token-limit', () => {
  it('detects gpt-5 and o-series models', () => {
    expect(usesMaxCompletionTokens('gpt-5.5')).to.equal(true);
    expect(usesMaxCompletionTokens('o3-mini')).to.equal(true);
    expect(usesMaxCompletionTokens('gpt-4o')).to.equal(false);
  });

  it('builds max_completion_tokens for newer models', () => {
    expect(buildOpenaiTokenLimitParams('gpt-5.5', 128000))
      .to.deep.equal({ max_completion_tokens: 128000 });
  });

  it('builds max_tokens for legacy models', () => {
    expect(buildOpenaiTokenLimitParams('gpt-4o-mini', 4096))
      .to.deep.equal({ max_tokens: 4096 });
  });

  it('omits temperature for gpt-5 and o-series', () => {
    expect(buildOpenaiTemperatureParam('gpt-5.5', 0.2)).to.deep.equal({});
    expect(buildOpenaiTemperatureParam('o3-mini', 0.2)).to.deep.equal({});
  });

  it('passes temperature for legacy models', () => {
    expect(buildOpenaiTemperatureParam('gpt-4o', 0.5)).to.deep.equal({ temperature: 0.5 });
    expect(buildOpenaiTemperatureParam('gpt-4o-mini')).to.deep.equal({ temperature: 0.2 });
  });
});

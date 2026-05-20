'use strict';

const { expect } = require('chai');
const contextBreakdown = require('../../../modules/admin-llm-chat/services/context.breakdown.service');

describe('context.breakdown.service', () => {
  it('estimateTokens returns positive for non-empty text', () => {
    const n = contextBreakdown.estimateTokens('hello world test message', 'gpt-4o');
    expect(n).to.be.above(0);
  });

  it('computeBreakdown splits system, tools, and conversation', async () => {
    const modelMeta = {
      id: 'claude-sonnet-4-6',
      provider: 'anthropic',
      contextWindow: 200000,
      supportsVision: true,
      maxOutputTokens: 8192,
    };
    const result = await contextBreakdown.computeBreakdown({
      conversation: { total_tokens_in: 1000, total_tokens_out: 500, system_prompt_version: 'v1' },
      userId: 'user-1',
      modelMeta,
      history: [
        { role: 'user', content: 'What was spend yesterday?', sequence_no: 1 },
        { role: 'assistant', content: 'Spend was $1,200.', sequence_no: 2, model_provider: 'anthropic' },
      ],
      summary: null,
      pendingUserContent: 'Follow up on Meta',
    });

    expect(result).to.exist;
    expect(result.effectiveTokens).to.be.above(0);
    expect(result.breakdown.length).to.be.above(0);
    const keys = result.breakdown.map((r) => r.key);
    expect(keys).to.include('system_prompt');
    expect(keys).to.include('tools');
    expect(keys).to.include('conversation');
    expect(result.billedTokens).to.equal(1500);
    expect(result.estimated).to.equal(true);
  });
});

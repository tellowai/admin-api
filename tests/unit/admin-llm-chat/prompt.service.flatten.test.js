'use strict';

const { expect } = require('chai');
const promptService = require('../../../modules/admin-llm-chat/services/prompt.service');
const contextSummaryService = require('../../../modules/admin-llm-chat/services/context.summary.service');

describe('prompt.service flattenToolCallsForProvider', () => {
  const toolCalls = [{
    tool_call_id: 'tc-1',
    tool_name: 'query_clickhouse',
    arguments_json: { sql: 'SELECT 1' },
    result_json: { rows: [{ a: 1 }] },
    rows_returned: 1,
  }];

  it('keeps native assistant+tool rows for same provider', () => {
    const rows = promptService.flattenToolCallsForProvider(toolCalls, 'openai', 'openai');
    expect(rows).to.have.length(2);
    expect(rows[0].role).to.equal('assistant');
    expect(rows[0].tool_calls[0].name).to.equal('query_clickhouse');
    expect(rows[1].role).to.equal('tool');
    expect(rows[1].tool_call_id).to.equal('tc-1');
  });

  it('flattens cross-provider tool calls into assistant text block', () => {
    const rows = promptService.flattenToolCallsForProvider(toolCalls, 'anthropic', 'openai');
    expect(rows).to.have.length(1);
    expect(rows[0].role).to.equal('assistant');
    expect(rows[0].content).to.include('[Used tool: query_clickhouse]');
    expect(rows[0].content).to.include('Args:');
    expect(rows[0].content).to.include('Result');
    expect(rows[0].tool_calls).to.be.undefined;
  });
});

describe('prompt.service buildMessagesForProvider with summary', () => {
  it('injects summary system block and filters older messages', () => {
    const history = [
      { role: 'user', content: 'old', sequence_no: 1 },
      { role: 'assistant', content: 'old reply', sequence_no: 2, model_provider: 'openai' },
      { role: 'user', content: 'recent', sequence_no: 9 },
      { role: 'assistant', content: 'recent reply', sequence_no: 10, model_provider: 'anthropic' },
    ];
    const summary = { summary_text: 'Prior topic: spend analysis.', through_sequence_no: 2 };
    const messages = promptService.buildMessagesForProvider(history, 'Base system', {
      activeProvider: 'anthropic',
      supportsVision: true,
      summary,
    });
    const systemBlocks = messages.filter((m) => m.role === 'system');
    expect(systemBlocks.some((m) => m.content.includes('Prior topic'))).to.equal(true);
    expect(messages.some((m) => m.content === 'recent')).to.equal(true);
    expect(messages.some((m) => m.content === 'old')).to.equal(false);
  });
});

describe('context.summary.service thresholds', () => {
  const model = { contextWindow: 100000 };

  it('computeUsedPct from conversation totals', () => {
    const pct = contextSummaryService.computeUsedPct(
      { total_tokens_in: 40000, total_tokens_out: 10000 },
      model,
    );
    expect(pct).to.equal(0.5);
  });

  it('shouldSummarize at AUTO threshold', () => {
    expect(contextSummaryService.shouldSummarize(
      { total_tokens_in: 85000, total_tokens_out: 0 },
      model,
    )).to.equal(true);
    expect(contextSummaryService.shouldSummarize(
      { total_tokens_in: 50000, total_tokens_out: 0 },
      model,
    )).to.equal(false);
  });
});

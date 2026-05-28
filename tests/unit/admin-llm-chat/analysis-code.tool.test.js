'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { runAnalysisCode } = require('../../../modules/admin-llm-chat/tools/analysis-code.tool');

describe('runAnalysisCode', () => {
  it('merges named input datasets', () => {
    const out = runAnalysisCode({
      code: `
        const a = inputs.left.reduce((s, r) => s + r.n, 0);
        const b = inputs.right.reduce((s, r) => s + r.n, 0);
        return { total: a + b };
      `,
      inputs: {
        left: [{ n: 1 }, { n: 2 }],
        right: [{ n: 10 }],
      },
    });
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.result.total, 13);
  });

  it('honors `result = ...` assignment without return', () => {
    const out = runAnalysisCode({
      code: 'result = { n: inputs.x + 1 };',
      inputs: { x: 41 },
    });
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.result.n, 42);
  });

  it('return takes precedence over result assignment', () => {
    const out = runAnalysisCode({
      code: 'result = { wrong: true }; return { right: true };',
      inputs: {},
    });
    assert.strictEqual(out.success, true);
    assert.strictEqual(out.result.right, true);
    assert.strictEqual(out.result.wrong, undefined);
  });

  it('blocks require', () => {
    const out = runAnalysisCode({ code: 'return require("fs");', inputs: {} });
    assert.strictEqual(out.success, false);
    assert.strictEqual(out.error, 'FORBIDDEN_IDENTIFIER');
  });
});

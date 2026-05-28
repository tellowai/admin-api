'use strict';

const vm = require('vm');
const CONSTANTS = require('../constants/admin-llm-chat.constants');

const FORBIDDEN = /\b(require|import|process|global|globalThis|eval|Function|child_process|fs|http|https|fetch|XMLHttpRequest|setTimeout|setInterval|setImmediate|Worker|SharedArrayBuffer)\b/;

const MAX_CODE_LEN = 12000;
const MAX_INPUT_BYTES = 400000;

function runAnalysisCode({ code, inputs = {} }) {
  if (!CONSTANTS.TOOL_RUN_ANALYSIS_CODE_ENABLED) {
    return { success: false, error: 'TOOL_DISABLED', message: 'run_analysis_code is disabled' };
  }
  const src = String(code || '').trim();
  if (!src) return { success: false, error: 'EMPTY_CODE', message: 'code is required' };
  if (src.length > MAX_CODE_LEN) {
    return { success: false, error: 'CODE_TOO_LONG', message: `Max ${MAX_CODE_LEN} characters` };
  }
  if (FORBIDDEN.test(src)) {
    return { success: false, error: 'FORBIDDEN_IDENTIFIER', message: 'Disallowed API in code' };
  }

  let safeInputs;
  try {
    safeInputs = JSON.parse(JSON.stringify(inputs ?? {}));
  } catch (_e) {
    return { success: false, error: 'INVALID_INPUTS', message: 'inputs must be JSON-serializable' };
  }
  if (Buffer.byteLength(JSON.stringify(safeInputs), 'utf8') > MAX_INPUT_BYTES) {
    return { success: false, error: 'INPUTS_TOO_LARGE', message: 'inputs JSON too large' };
  }

  const sandbox = {
    inputs: safeInputs,
    Math,
    JSON,
    Date,
    Array,
    Object,
    Map,
    Set,
    Number,
    String,
    Boolean,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    RegExp,
    Error,
    result: undefined,
  };

  // IIFE so user `return ...` works. `result = ...` (no var/let/const) inside
  // the function also persists because we only overwrite sandbox.result when
  // the IIFE actually returns something — preventing the historical bug where
  // a bare `result = ...` was clobbered by the IIFE's undefined return.
  const wrapped = `"use strict";
(function(inputs) {
  const __ret = (function(inputs) {
${src}
  })(inputs);
  if (typeof __ret !== 'undefined') result = __ret;
})(inputs);
`;

  try {
    vm.runInNewContext(wrapped, sandbox, {
      timeout: CONSTANTS.ANALYSIS_CODE_TIMEOUT_MS,
    });
    const out = sandbox.result;
    const serialized = JSON.stringify(out === undefined ? null : out);
    if (serialized && serialized.length > CONSTANTS.MAX_TOOL_RESULT_TOKENS * 4) {
      return {
        success: false,
        error: 'RESULT_TOO_LARGE',
        message: 'Shrink the returned object or aggregate in code',
      };
    }
    return {
      success: true,
      result: out === undefined ? null : out,
      result_type: out === null ? 'null' : typeof out,
      hint: out === undefined
        ? 'No value produced. End your code with `return <value>` or assign `result = <value>`.'
        : undefined,
    };
  } catch (e) {
    return {
      success: false,
      error: 'EXEC_ERROR',
      message: String(e.message || e).slice(0, 500),
    };
  }
}

module.exports = { runAnalysisCode };

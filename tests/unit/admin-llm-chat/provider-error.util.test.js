'use strict';

const assert = require('assert');
const { formatProviderError } = require('../../../modules/admin-llm-chat/services/provider-error.util');

describe('provider-error.util', () => {
  it('maps anthropic billing errors to a short message', () => {
    const result = formatProviderError(new Error(
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
    ));
    assert.strictEqual(result.code, 'PROVIDER_BILLING');
    assert.match(result.message, /Anthropic API credits/i);
    assert.strictEqual(result.retryable, false);
  });
});

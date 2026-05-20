'use strict';

const { expect } = require('chai');
const { evaluateUserMessage } = require('../../../modules/admin-llm-chat/services/message-scope.util');

describe('message-scope.util', () => {
  it('refuses telugu joke', () => {
    const r = evaluateUserMessage('tell me a short telugu joke');
    expect(r.refuse).to.equal(true);
  });

  it('refuses horror story', () => {
    const r = evaluateUserMessage('hi there, can you write a horror story?');
    expect(r.refuse).to.equal(true);
  });

  it('allows revenue question', () => {
    const r = evaluateUserMessage('total revenue this month by currency');
    expect(r.refuse).to.equal(false);
  });

  it('allows story when business context present', () => {
    const r = evaluateUserMessage('tell me the story behind the drop in Meta spend yesterday');
    expect(r.refuse).to.equal(false);
  });
});

'use strict';

const { expect } = require('chai');
const extractionService = require('../../../modules/admin-llm-chat/services/memory.extraction.service');

describe('memory.extraction.service', () => {
  it('exports background scheduler', () => {
    expect(extractionService.schedulePostTurnExtraction).to.be.a('function');
    expect(extractionService.extractSemanticMemories).to.be.a('function');
    expect(extractionService.extractEpisodicMemory).to.be.a('function');
  });

  it('schedulePostTurnExtraction does not throw when disabled path', () => {
    expect(() => extractionService.schedulePostTurnExtraction({
      userId: 'u1',
      conversationId: 'c1',
      userContent: 'hi',
      assistantContent: 'hello',
      toolCallCount: 0,
      rememberToolUsed: false,
    })).to.not.throw();
  });
});

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

  describe('shouldAttemptSemanticExtraction', () => {
    it('skips pure analytics questions', () => {
      expect(extractionService.shouldAttemptSemanticExtraction(
        'Show Meta spend and ROAS for the last 7 days vs prior week',
      )).to.equal(false);
    });

    it('allows explicit preference language', () => {
      expect(extractionService.shouldAttemptSemanticExtraction(
        'Remember that our primary monetization is alacarte purchases, subscriptions are secondary',
      )).to.equal(true);
    });

    it('skips declarative facts without explicit persistence intent', () => {
      expect(extractionService.shouldAttemptSemanticExtraction(
        'Primary monetization focus is alacarte image templates at ₹19',
      )).to.equal(false);
    });

    it('skips when remember tool already stored the fact', () => {
      expect(extractionService.shouldAttemptSemanticExtraction(
        'Remember our default currency is INR',
        { rememberToolUsed: true },
      )).to.equal(false);
    });

    it('skips short greetings', () => {
      expect(extractionService.shouldAttemptSemanticExtraction('thanks')).to.equal(false);
    });
  });

  describe('filterDurableMemoryBatch', () => {
    it('drops transient analysis-style values', () => {
      const out = extractionService.filterDurableMemoryBatch([
        { key: 'meta_roas', value: 'ROAS was 2.1 last week', category: 'metrics' },
        { key: 'commerce_focus', value: 'Primary monetization is alacarte purchases', category: 'product' },
      ]);
      expect(out).to.have.length(1);
      expect(out[0].key).to.equal('commerce_focus');
    });

    it('drops invalid categories and empty keys', () => {
      const out = extractionService.filterDurableMemoryBatch([
        { key: '', value: 'something', category: 'preferences' },
        { key: 'ok', value: 'Preferred currency is INR', category: 'unknown' },
      ]);
      expect(out).to.have.length(0);
    });
  });
});

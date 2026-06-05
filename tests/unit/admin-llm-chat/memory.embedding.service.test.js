'use strict';

const { expect } = require('chai');
const embeddingService = require('../../../modules/admin-llm-chat/services/memory.embedding.service');

describe('memory.embedding.service', () => {
  it('cosineSimilarity returns 1 for identical vectors', () => {
    const v = [1, 0, 0];
    expect(embeddingService.cosineSimilarity(v, v)).to.be.closeTo(1, 0.0001);
  });

  it('cosineSimilarity returns 0 for orthogonal vectors', () => {
    expect(embeddingService.cosineSimilarity([1, 0], [0, 1])).to.equal(0);
  });

  it('keywordScore finds overlapping terms', () => {
    const score = embeddingService.keywordScore('meta ads spend', 'user prefers meta ads channel');
    expect(score).to.be.greaterThan(0);
  });

  it('hybridScore blends semantic and keyword', () => {
    const score = embeddingService.hybridScore({ semantic: 0.8, keyword: 0.2 });
    expect(score).to.be.greaterThan(0.5);
    expect(score).to.be.lessThan(1);
  });

  it('parseEmbeddingJson handles array and string JSON', () => {
    expect(embeddingService.parseEmbeddingJson([0.1, 0.2])).to.deep.equal([0.1, 0.2]);
    expect(embeddingService.parseEmbeddingJson('[0.1,0.2]')).to.deep.equal([0.1, 0.2]);
    expect(embeddingService.parseEmbeddingJson(null)).to.equal(null);
  });
});

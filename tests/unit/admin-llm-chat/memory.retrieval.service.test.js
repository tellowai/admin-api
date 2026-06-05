'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const MemoryModel = require('../../../modules/admin-llm-chat/models/memory.model');
const EpisodicModel = require('../../../modules/admin-llm-chat/models/episodic.model');
const ProfileModel = require('../../../modules/admin-llm-chat/models/profile.model');
const embeddingService = require('../../../modules/admin-llm-chat/services/memory.embedding.service');
const retrievalService = require('../../../modules/admin-llm-chat/services/memory.retrieval.service');

describe('memory.retrieval.service', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(ProfileModel, 'getByUser').resolves({ currency: 'INR', focus_channels: ['meta'] });
    sandbox.stub(embeddingService, 'embedText').resolves([1, 0, 0]);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('includes profile block always', async () => {
    sandbox.stub(MemoryModel, 'listByUser').resolves([]);
    sandbox.stub(EpisodicModel, 'listByUser').resolves([]);
    const result = await retrievalService.retrieveForTurn({ userId: 'u1', queryText: 'revenue' });
    expect(result.profileBlock).to.include('currency');
    expect(result.profileBlock).to.include('INR');
  });

  it('selects memories by hybrid score when query provided', async () => {
    sandbox.stub(MemoryModel, 'listByUser').resolves([
      {
        memory_key: 'preferred_currency',
        memory_value: 'INR',
        embedding_json: [1, 0, 0],
      },
      {
        memory_key: 'unrelated',
        memory_value: 'likes poetry',
        embedding_json: [0, 1, 0],
      },
    ]);
    sandbox.stub(EpisodicModel, 'listByUser').resolves([]);
    const result = await retrievalService.retrieveForTurn({ userId: 'u1', queryText: 'INR revenue' });
    expect(result.memoryBlock).to.include('preferred_currency');
    expect(result.memoryBlock).to.not.include('poetry');
  });

  it('scoreMemoryRow ranks higher semantic match', () => {
    const high = retrievalService.scoreMemoryRow(
      { memory_key: 'k', memory_value: 'meta ads', embedding_json: [1, 0] },
      'meta ads spend',
      [1, 0],
    );
    const low = retrievalService.scoreMemoryRow(
      { memory_key: 'k2', memory_value: 'google', embedding_json: [0, 1] },
      'meta ads spend',
      [1, 0],
    );
    expect(high.score).to.be.greaterThan(low.score);
  });
});

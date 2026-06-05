'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const MemoryModel = require('../../../modules/admin-llm-chat/models/memory.model');
const embeddingService = require('../../../modules/admin-llm-chat/services/memory.embedding.service');
const profileService = require('../../../modules/admin-llm-chat/services/memory.profile.service');
const memoryService = require('../../../modules/admin-llm-chat/services/memory.service');

describe('memory.service batch upsert', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(embeddingService, 'embedTexts').resolves([[0.1, 0.2], [0.3, 0.4]]);
    sandbox.stub(MemoryModel, 'upsertMany').resolves([]);
    sandbox.stub(profileService, 'mergeFactsIntoProfile').resolves({});
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('uses one embedTexts call and one upsertMany for multiple items', async () => {
    const result = await memoryService.upsertSemanticMemoriesBatch('user-1', [
      { key: 'currency', value: 'INR' },
      { key: 'focus_channel', value: 'meta' },
    ]);
    expect(result).to.have.length(2);
    expect(embeddingService.embedTexts.calledOnce).to.equal(true);
    expect(MemoryModel.upsertMany.calledOnce).to.equal(true);
    expect(MemoryModel.upsertMany.firstCall.args[0]).to.have.length(2);
    expect(profileService.mergeFactsIntoProfile.calledOnce).to.equal(true);
  });
});

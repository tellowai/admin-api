'use strict';

const CONSTANTS = require('../constants/admin-llm-chat.constants');
const MemoryModel = require('../models/memory.model');
const embeddingService = require('./memory.embedding.service');
const profileService = require('./memory.profile.service');

function buildUpsertRow(userId, key, value, extras = {}, embedding = null) {
  const embeddingModel = embedding ? CONSTANTS.MEMORY_EMBEDDING_MODEL : (extras.embeddingModel || null);
  return {
    userId,
    key,
    value,
    extras: {
      memoryType: extras.memoryType || 'semantic',
      embeddingJson: embedding || extras.embedding || null,
      embeddingModel,
      sourceConversationId: extras.sourceConversationId || null,
      metadataJson: extras.metadataJson || null,
      expiresAt: extras.expiresAt || null,
    },
  };
}

async function upsertSemanticMemory(userId, key, value, extras = {}) {
  const [saved] = await upsertSemanticMemoriesBatch(userId, [{ key, value, extras }]);
  return saved;
}

/**
 * Batch path: one embedding API call + one DB upsert + one profile merge.
 * No queries inside loops.
 */
async function upsertSemanticMemoriesBatch(userId, items) {
  const normalized = items
    .map((item) => ({
      key: String(item.key || '').trim().slice(0, 255),
      value: String(item.value || '').trim().slice(0, 4000),
      extras: item.extras || {},
    }))
    .filter((item) => item.key && item.value);

  if (!normalized.length) return [];

  let embeddings = [];
  if (CONSTANTS.MEMORY_EMBEDDING_ENABLED) {
    const texts = normalized.map((item) => `${item.key}: ${item.value}`);
    embeddings = await embeddingService.embedTexts(texts);
  }

  const rows = normalized.map((item, idx) => buildUpsertRow(
    userId,
    item.key,
    item.value,
    item.extras,
    embeddings[idx] || null,
  ));

  await MemoryModel.upsertMany(rows);

  if (CONSTANTS.MEMORY_PROFILE_AUTO_UPDATE) {
    profileService.mergeFactsIntoProfile(
      userId,
      normalized.map((item) => ({ key: item.key, value: item.value })),
    ).catch(() => {});
  }

  return normalized.map((item) => ({ key: item.key, value: item.value }));
}

module.exports = {
  upsertSemanticMemory,
  upsertSemanticMemoriesBatch,
};

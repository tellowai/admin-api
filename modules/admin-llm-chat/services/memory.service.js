'use strict';

const CONSTANTS = require('../constants/admin-llm-chat.constants');
const MemoryModel = require('../models/memory.model');
const embeddingService = require('./memory.embedding.service');
const profileService = require('./memory.profile.service');
const { dedupeIncomingMemories } = require('../utils/memory.dedup.util');

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

  const existing = await MemoryModel.listByUser(userId);
  const { items: deduped, retireKeys } = dedupeIncomingMemories(normalized, existing);
  if (!deduped.length) return [];

  let embeddings = [];
  if (CONSTANTS.MEMORY_EMBEDDING_ENABLED) {
    const texts = deduped.map((item) => `${item.key}: ${item.value}`);
    embeddings = await embeddingService.embedTexts(texts);
  }

  const rows = deduped.map((item, idx) => buildUpsertRow(
    userId,
    item.key,
    item.value,
    item.extras,
    embeddings[idx] || null,
  ));

  await MemoryModel.upsertMany(rows);

  if (retireKeys.length) {
    await Promise.all(retireKeys.map((key) => MemoryModel.softDeleteMemory(userId, key).catch(() => {})));
  }

  if (CONSTANTS.MEMORY_PROFILE_AUTO_UPDATE) {
    profileService.mergeFactsIntoProfile(
      userId,
      deduped.map((item) => ({ key: item.key, value: item.value })),
    ).catch(() => {});
  }

  return deduped.map((item) => ({ key: item.key, value: item.value }));
}

module.exports = {
  upsertSemanticMemory,
  upsertSemanticMemoriesBatch,
};

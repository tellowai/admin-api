'use strict';

const CONSTANTS = require('../constants/admin-llm-chat.constants');
const MemoryModel = require('../models/memory.model');
const EpisodicModel = require('../models/episodic.model');
const ProfileModel = require('../models/profile.model');
const embeddingService = require('./memory.embedding.service');

function formatProfileBlock(profile) {
  const entries = Object.entries(profile || {}).filter(([, v]) => {
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'string') return v.trim().length > 0;
    return true;
  });
  if (!entries.length) return '';
  const lines = entries.map(([k, v]) => {
    const val = Array.isArray(v) ? v.join(', ') : String(v);
    return `- ${k}: ${val}`;
  });
  return `\nUser profile:\n${lines.join('\n')}`;
}

function scoreMemoryRow(row, queryText, queryEmbedding) {
  const text = `${row.memory_key}: ${row.memory_value}`;
  const storedEmbedding = embeddingService.parseEmbeddingJson(row.embedding_json);
  const semantic = queryEmbedding && storedEmbedding
    ? embeddingService.cosineSimilarity(queryEmbedding, storedEmbedding)
    : 0;
  const keyword = embeddingService.keywordScore(queryText, text);
  return {
    row,
    score: embeddingService.hybridScore({ semantic, keyword }),
    semantic,
    keyword,
  };
}

function scoreEpisodicRow(row, queryText, queryEmbedding) {
  const text = row.summary_text || '';
  const storedEmbedding = embeddingService.parseEmbeddingJson(row.embedding_json);
  const semantic = queryEmbedding && storedEmbedding
    ? embeddingService.cosineSimilarity(queryEmbedding, storedEmbedding)
    : 0;
  const keyword = embeddingService.keywordScore(queryText, text);
  return {
    row,
    score: embeddingService.hybridScore({ semantic, keyword }),
  };
}

function selectTop(scored, topK, minScore) {
  return scored
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

async function retrieveForTurn({ userId, queryText }) {
  const [profile, memories, episodic] = await Promise.all([
    ProfileModel.getByUser(userId),
    MemoryModel.listByUser(userId),
    EpisodicModel.listByUser(userId, { limit: CONSTANTS.MEMORY_EPISODIC_CANDIDATE_LIMIT }),
  ]);

  const profileBlock = formatProfileBlock(profile);
  const query = String(queryText || '').trim();

  let queryEmbedding = null;
  if (query && CONSTANTS.MEMORY_EMBEDDING_ENABLED) {
    queryEmbedding = await embeddingService.embedText(query);
  }

  let selectedMemories = memories;
  if (query && memories.length > 0 && CONSTANTS.MEMORY_RETRIEVAL_ENABLED) {
    const scored = memories.map((m) => scoreMemoryRow(m, query, queryEmbedding));
    const top = selectTop(
      scored,
      CONSTANTS.MEMORY_RETRIEVAL_TOP_K,
      CONSTANTS.MEMORY_RETRIEVAL_MIN_SCORE,
    );
    selectedMemories = top.length ? top.map((s) => s.row) : memories.slice(0, CONSTANTS.MEMORY_RETRIEVAL_TOP_K);
  } else if (memories.length > CONSTANTS.MEMORY_FULL_DUMP_MAX) {
    selectedMemories = memories.slice(0, CONSTANTS.MEMORY_FULL_DUMP_MAX);
  }

  let selectedEpisodic = [];
  if (episodic.length && query) {
    const scored = episodic.map((e) => scoreEpisodicRow(e, query, queryEmbedding));
    selectedEpisodic = selectTop(
      scored,
      CONSTANTS.MEMORY_EPISODIC_TOP_K,
      CONSTANTS.MEMORY_RETRIEVAL_MIN_SCORE,
    ).map((s) => s.row);
  }

  const memoryBlock = selectedMemories.length
    ? `\nUser preferences & facts:\n${selectedMemories.map((m) => `- ${m.memory_key}: ${m.memory_value}`).join('\n')}`
    : '';

  const episodicBlock = selectedEpisodic.length
    ? `\nRelevant past analyses:\n${selectedEpisodic.map((e) => `- ${e.summary_text}`).join('\n')}`
    : '';

  return {
    profile,
    profileBlock,
    memoryBlock,
    episodicBlock,
    memories: `${profileBlock}${memoryBlock}${episodicBlock}`,
    selectedCount: selectedMemories.length,
    totalCount: memories.length,
    episodicCount: selectedEpisodic.length,
  };
}

module.exports = {
  retrieveForTurn,
  formatProfileBlock,
  scoreMemoryRow,
  scoreEpisodicRow,
};

'use strict';

const CONSTANTS = require('../constants/admin-llm-chat.constants');
const { createOpenaiChatClient } = require('./llm-auxiliary.client');

function parseEmbeddingJson(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : null;
  } catch (_e) {
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/** Lightweight BM25-style keyword overlap (no external deps). */
function keywordScore(query, text) {
  const qTokens = new Set(tokenize(query));
  if (!qTokens.size) return 0;
  const docTokens = tokenize(text);
  if (!docTokens.length) return 0;
  let hits = 0;
  docTokens.forEach((t) => {
    if (qTokens.has(t)) hits += 1;
  });
  return hits / Math.max(docTokens.length, qTokens.size);
}

async function embedText(text) {
  const input = String(text || '').trim();
  if (!input) return null;
  if (!CONSTANTS.MEMORY_EMBEDDING_ENABLED) return null;
  try {
    const client = await createOpenaiChatClient();
    const resp = await client.embeddings.create({
      model: CONSTANTS.MEMORY_EMBEDDING_MODEL,
      input,
    });
    return resp.data?.[0]?.embedding || null;
  } catch (_e) {
    return null;
  }
}

async function embedTexts(texts) {
  const inputs = texts.map((t) => String(t || '').trim()).filter(Boolean);
  if (!inputs.length || !CONSTANTS.MEMORY_EMBEDDING_ENABLED) return [];
  try {
    const client = await createOpenaiChatClient();
    const resp = await client.embeddings.create({
      model: CONSTANTS.MEMORY_EMBEDDING_MODEL,
      input: inputs,
    });
    return (resp.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
  } catch (_e) {
    return inputs.map(() => null);
  }
}

function hybridScore({ semantic = 0, keyword = 0 }) {
  const wSemantic = CONSTANTS.MEMORY_RETRIEVAL_SEMANTIC_WEIGHT;
  const wKeyword = CONSTANTS.MEMORY_RETRIEVAL_KEYWORD_WEIGHT;
  return (semantic * wSemantic) + (keyword * wKeyword);
}

module.exports = {
  parseEmbeddingJson,
  cosineSimilarity,
  keywordScore,
  embedText,
  embedTexts,
  hybridScore,
  tokenize,
};

'use strict';

const fs = require('fs');
const path = require('path');
const CONSTANTS = require('../constants/admin-llm-chat.constants');
const modelsRegistry = require('./models.registry.service');
const { completeShortText } = require('./llm-auxiliary.client');
const memoryService = require('./memory.service');
const EpisodicModel = require('../models/episodic.model');
const embeddingService = require('./memory.embedding.service');
const circuitBreaker = require('./circuit-breaker.util');
const rateLimit = require('./rate-limit.service');
const { redactString, truncatePreview } = require('./pii.redactor');
const logger = require('../../../config/lib/logger');

const CB_EXTRACT = 'admin_llm_chat_memory_extract';
const CB_EPISODIC = 'admin_llm_chat_episodic_extract';
const EXTRACT_PROMPT_PATH = path.join(__dirname, '../constants/system.prompts/v1.memory-extract.txt');
const EPISODIC_PROMPT_PATH = path.join(__dirname, '../constants/system.prompts/v1.episodic-extract.txt');

function loadPrompt(filePath, fallback) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return fallback;
  }
}

function parseJsonArray(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (_e) {
    return null;
  }
}

async function extractSemanticMemories({ userId, conversationId, userContent, assistantContent }) {
  if (!CONSTANTS.MEMORY_EXTRACTION_ENABLED) return [];
  if (circuitBreaker.isOpen(CB_EXTRACT)) return [];
  if (userId === CONSTANTS.DIGEST_SYSTEM_USER_ID) return [];

  try {
    await rateLimit.assertUserRpm(userId, 'memory_extract', CONSTANTS.MEMORY_EXTRACTION_PER_USER_PER_MIN);
  } catch (_e) {
    return [];
  }

  const summarizer = modelsRegistry.getSummarizerModel();
  if (!summarizer) return [];

  const system = loadPrompt(EXTRACT_PROMPT_PATH, 'Extract durable facts as JSON array.');
  const userText = truncatePreview(redactString(userContent || ''), 2000);
  const assistantText = truncatePreview(redactString(assistantContent || ''), 3000);
  if (!userText.trim() && !assistantText.trim()) return [];

  let text = '';
  try {
    const result = await completeShortText({
      summarizer,
      system,
      userContent: `User:\n${userText}\n\nAssistant:\n${assistantText}`,
      maxTokens: 512,
    });
    text = result.text;
    circuitBreaker.recordSuccess(CB_EXTRACT);
  } catch (err) {
    circuitBreaker.recordFailure(CB_EXTRACT);
    logger.warn('admin_llm_chat memory extract failed', { err: err.message, userId });
    return [];
  }

  const items = parseJsonArray(text).slice(0, CONSTANTS.MEMORY_EXTRACTION_MAX_PER_TURN);
  const batch = items
    .map((item) => ({
      key: String(item?.key || '').trim(),
      value: String(item?.value || '').trim(),
      extras: {
        sourceConversationId: conversationId,
        metadataJson: { category: item?.category || 'preferences', source: 'background_extract' },
      },
    }))
    .filter((item) => item.key && item.value);

  return memoryService.upsertSemanticMemoriesBatch(userId, batch);
}

async function extractEpisodicMemory({
  userId,
  conversationId,
  userContent,
  assistantContent,
  throughMessageId,
  toolCallCount,
}) {
  if (!CONSTANTS.MEMORY_EPISODIC_ENABLED) return null;
  if (circuitBreaker.isOpen(CB_EPISODIC)) return null;
  if (!toolCallCount || toolCallCount < 1) return null;
  if (userId === CONSTANTS.DIGEST_SYSTEM_USER_ID) return null;

  try {
    await rateLimit.assertUserRpm(userId, 'episodic_extract', CONSTANTS.MEMORY_EPISODIC_PER_USER_PER_MIN);
  } catch (_e) {
    return null;
  }

  const summarizer = modelsRegistry.getSummarizerModel();
  if (!summarizer) return null;

  const system = loadPrompt(EPISODIC_PROMPT_PATH, 'Summarize analysis session as JSON.');
  const userText = truncatePreview(redactString(userContent || ''), 1500);
  const assistantText = truncatePreview(redactString(assistantContent || ''), 2500);

  let text = '';
  try {
    const result = await completeShortText({
      summarizer,
      system,
      userContent: `User:\n${userText}\n\nAssistant:\n${assistantText}`,
      maxTokens: 400,
    });
    text = result.text;
    circuitBreaker.recordSuccess(CB_EPISODIC);
  } catch (err) {
    circuitBreaker.recordFailure(CB_EPISODIC);
    logger.warn('admin_llm_chat episodic extract failed', { err: err.message, userId });
    return null;
  }

  const parsed = parseJsonObject(text);
  const summary = String(parsed?.summary || '').trim();
  if (!summary) return null;

  const topics = Array.isArray(parsed?.topics) ? parsed.topics.slice(0, 8) : [];
  let embedding = null;
  let embeddingModel = null;
  if (CONSTANTS.MEMORY_EMBEDDING_ENABLED) {
    embedding = await embeddingService.embedText(summary);
    if (embedding) embeddingModel = CONSTANTS.MEMORY_EMBEDDING_MODEL;
  }

  await EpisodicModel.insert({
    user_id: userId,
    conversation_id: conversationId,
    summary_text: summary.slice(0, 8000),
    topics_json: topics,
    embedding_json: embedding,
    embedding_model: embeddingModel,
    through_message_id: throughMessageId || null,
  });

  return { summary, topics };
}

function schedulePostTurnExtraction({
  userId,
  conversationId,
  userContent,
  assistantContent,
  throughMessageId,
  toolCallCount,
  rememberToolUsed,
}) {
  if (!CONSTANTS.MEMORY_BACKGROUND_ENABLED) return;
  if (rememberToolUsed && !CONSTANTS.MEMORY_EXTRACT_WHEN_REMEMBER_USED) return;

  const substanceLen = String(userContent || '').length + String(assistantContent || '').length;
  if (!toolCallCount && !rememberToolUsed && substanceLen < 40) return;

  setImmediate(() => {
    Promise.all([
      extractSemanticMemories({ userId, conversationId, userContent, assistantContent }),
      extractEpisodicMemory({
        userId,
        conversationId,
        userContent,
        assistantContent,
        throughMessageId,
        toolCallCount,
      }),
    ]).catch((err) => {
      logger.warn('admin_llm_chat post-turn memory failed', { err: err.message, userId, conversationId });
    });
  });
}

module.exports = {
  extractSemanticMemories,
  extractEpisodicMemory,
  schedulePostTurnExtraction,
};

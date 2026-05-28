'use strict';

const modelsRegistry = require('./models.registry.service');
const { completeShortText } = require('./llm-auxiliary.client');
const ConversationModel = require('../models/conversation.model');
const CONSTANTS = require('../constants/admin-llm-chat.constants');
const { redactString } = require('./pii.redactor');
const circuitBreaker = require('./circuit-breaker.util');
const rateLimit = require('./rate-limit.service');
const logger = require('../../../config/lib/logger');

const CB_NAME = 'admin_llm_chat_title';

const DEFAULT_TITLES = new Set(['new chat', '']);

function shouldAutoTitle(conversation) {
  const t = (conversation.title || '').trim().toLowerCase();
  return DEFAULT_TITLES.has(t);
}

function sanitizeTitle(raw) {
  if (!raw) return null;
  let t = String(raw).replace(/["'`]/g, '').replace(/\s+/g, ' ').trim();
  if (t.length > 80) t = `${t.slice(0, 77)}…`;
  return t || null;
}

function fallbackTitle(firstUser) {
  const t = redactString((firstUser || '').trim()).slice(0, 48);
  return t ? sanitizeTitle(t) : 'New chat';
}

async function generateTitle(conversation, firstUser, firstAssistantText, userId) {
  if (!shouldAutoTitle(conversation)) return null;
  if (circuitBreaker.isOpen(CB_NAME)) return fallbackTitle(firstUser);
  if (userId) {
    try {
      await rateLimit.assertUserRpm(userId, 'title', CONSTANTS.TITLE_PER_USER_PER_MIN);
    } catch (err) {
      logger.warn('admin_llm_chat title rate limited', { userId });
      return fallbackTitle(firstUser);
    }
  }

  const summarizer = modelsRegistry.getSummarizerModel();
  if (!summarizer) return fallbackTitle(firstUser);

  const userSnippet = redactString((firstUser || '').slice(0, 400));
  const assistantSnippet = redactString((firstAssistantText || '').slice(0, 400));
  const prompt = `Give a 3 to 6 word title summarizing this chat. No quotes, no punctuation, Title Case only.\nUser: ${userSnippet}\nAssistant: ${assistantSnippet}`;

  try {
    const { text } = await completeShortText({
      summarizer,
      userContent: prompt,
      maxTokens: 30,
    });
    const title = sanitizeTitle(text);
    circuitBreaker.recordSuccess(CB_NAME);
    return title || fallbackTitle(firstUser);
  } catch (err) {
    circuitBreaker.recordFailure(CB_NAME);
    logger.warn('admin_llm_chat title generation failed', { err: err.message });
    return fallbackTitle(firstUser);
  }
}

async function applyTitle(conversationId, userId, title) {
  if (!title) return null;
  const conv = await ConversationModel.getByIdForUser(conversationId, userId);
  if (!conv || !shouldAutoTitle(conv)) return null;
  await ConversationModel.update(conversationId, userId, { title });
  return title;
}

module.exports = { shouldAutoTitle, generateTitle, applyTitle, sanitizeTitle };

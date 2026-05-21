'use strict';

const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const CONSTANTS = require('../constants/admin-llm-chat.constants');
const modelsRegistry = require('./models.registry.service');
const { completeShortText } = require('./llm-auxiliary.client');
const ContextSummaryModel = require('../models/context.summary.model');
const conversationData = require('./conversation-data.service');
const contextBreakdown = require('./context.breakdown.service');
const { redactString, truncatePreview } = require('./pii.redactor');
const circuitBreaker = require('./circuit-breaker.util');
const rateLimit = require('./rate-limit.service');
const logger = require('../../../config/lib/logger');

const CB_NAME = 'admin_llm_chat_summary';

const SUMMARY_PROMPT_PATH = path.join(__dirname, '../constants/system.prompts/v1.summary.txt');

function loadSummaryPrompt() {
  try {
    return fs.readFileSync(SUMMARY_PROMPT_PATH, 'utf8');
  } catch (_e) {
    return 'Summarize this admin marketing chat for continuity. Include goals, decisions, tool queries with headline results, open threads, and current topic. Be concise.';
  }
}

/** Legacy: lifetime billed tokens vs model window (misleading after summarization). */
function computeUsedPct(conversation, modelMeta) {
  const used = (conversation.total_tokens_in || 0) + (conversation.total_tokens_out || 0);
  const limit = modelMeta?.contextWindow || 128000;
  return limit > 0 ? used / limit : 0;
}

/** Effective context that will be sent on the next turn (respects summary + recent tail). */
async function computeEffectiveUsedPct(conversation, modelMeta, userId, options = {}) {
  if (!modelMeta) return null;
  const usage = await contextBreakdown.computeForConversation(conversation, userId, options);
  return usage?.pct ?? null;
}

async function shouldSummarize(conversation, modelMeta, userId, options = {}) {
  const effectivePct = await computeEffectiveUsedPct(conversation, modelMeta, userId, options);
  if (effectivePct == null) return false;
  return effectivePct >= CONSTANTS.CONTEXT_USAGE_AUTO_PCT;
}

async function buildSummaryInput(messages, toolByMsg) {
  const lines = [];
  messages.forEach((m) => {
    if (m.role === 'user' || m.role === 'assistant') {
      lines.push(`${m.role}: ${truncatePreview(redactString(m.content || ''), 400)}`);
    }
    const tools = toolByMsg[m.message_id] || [];
    tools.forEach((tc) => {
      const result = typeof tc.result_json === 'string' ? tc.result_json : JSON.stringify(tc.result_json || {});
      lines.push(`tool ${tc.tool_name}: ${truncatePreview(redactString(result), 300)}`);
    });
  });
  return lines.join('\n');
}

async function summarize(conversation, { keepRecent = CONSTANTS.SUMMARY_KEEP_RECENT_TURNS, userId } = {}) {
  if (circuitBreaker.isOpen(CB_NAME)) return null;
  if (userId) {
    try {
      await rateLimit.assertUserRpm(userId, 'summary', CONSTANTS.SUMMARY_PER_USER_PER_MIN);
    } catch (err) {
      logger.warn('admin_llm_chat summary rate limited', { userId });
      return null;
    }
  }

  const { messages, toolCalls } = await conversationData.loadMessagesWithTools(conversation.conversation_id);
  if (messages.length <= keepRecent + 2) return null;

  const cutoffIdx = Math.max(0, messages.length - keepRecent);
  const toSummarize = messages.slice(0, cutoffIdx);
  const lastIncluded = toSummarize[toSummarize.length - 1];
  if (!lastIncluded) return null;

  const summarizer = modelsRegistry.getSummarizerModel();
  if (!summarizer) return null;

  const messageIds = new Set(toSummarize.map((m) => m.message_id));
  const toolByMsg = {};
  toolCalls.filter((tc) => messageIds.has(tc.message_id)).forEach((tc) => {
    if (!toolByMsg[tc.message_id]) toolByMsg[tc.message_id] = [];
    toolByMsg[tc.message_id].push(tc);
  });

  const input = await buildSummaryInput(toSummarize, toolByMsg);
  const system = loadSummaryPrompt();
  const userContent = `Conversation transcript to summarize:\n\n${input}`;

  let summaryText = '';
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    const result = await completeShortText({
      summarizer,
      system,
      userContent,
      maxTokens: CONSTANTS.SUMMARY_TARGET_TOKENS,
    });
    summaryText = result.text;
    promptTokens = result.promptTokens;
    completionTokens = result.completionTokens;
  } catch (err) {
    circuitBreaker.recordFailure(CB_NAME);
    logger.warn('admin_llm_chat summary failed', { err: err.message, conversationId: conversation.conversation_id });
    return null;
  }

  circuitBreaker.recordSuccess(CB_NAME);
  summaryText = truncatePreview(redactString(summaryText), CONSTANTS.SUMMARY_TARGET_TOKENS * 4);
  await ContextSummaryModel.supersedeForConversation(conversation.conversation_id);
  const summaryId = uuidv4();
  await ContextSummaryModel.create({
    summary_id: summaryId,
    conversation_id: conversation.conversation_id,
    summary_text: summaryText,
    through_message_id: lastIncluded.message_id,
    through_sequence_no: lastIncluded.sequence_no,
    summarizer_provider: summarizer.provider,
    summarizer_model_id: summarizer.id,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
  });

  return ContextSummaryModel.getLatest(conversation.conversation_id);
}

module.exports = {
  computeUsedPct,
  computeEffectiveUsedPct,
  shouldSummarize,
  summarize,
};

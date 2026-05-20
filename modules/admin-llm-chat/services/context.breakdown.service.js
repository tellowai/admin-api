'use strict';

const { TOOL_DEFINITIONS, toOpenAITools, toAnthropicTools } = require('../constants/tool.registry');
const promptService = require('./prompt.service');
const MessageModel = require('../models/message.model');
const ToolCallModel = require('../models/tool_call.model');
const ContextSummaryModel = require('../models/context.summary.model');
const modelsRegistry = require('./models.registry.service');

const CATEGORIES = [
  { key: 'system_prompt', label: 'System prompt', color: '#9ca3af' },
  { key: 'business_context', label: 'Business context', color: '#22c55e' },
  { key: 'table_catalog', label: 'Table catalog', color: '#14b8a6' },
  { key: 'memories', label: 'Memories', color: '#f97316' },
  { key: 'tools', label: 'Tools', color: '#a855f7' },
  { key: 'summarized_conversation', label: 'Summarized conversation', color: '#ec4899' },
  { key: 'conversation', label: 'Conversation', color: '#6366f1' },
  { key: 'attachments', label: 'Attachments', color: '#eab308' },
];

function estimateTokens(text, _modelId) {
  if (!text) return 0;
  const s = String(text);
  try {
    const { encoding_for_model } = require('tiktoken');
    const enc = encoding_for_model('gpt-4o');
    const n = enc.encode(s).length;
    enc.free();
    return n;
  } catch (_e) {
    return Math.ceil(s.length / 4);
  }
}

function contentToString(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => {
      if (p.type === 'text') return p.text || '';
      if (p.type === 'image' || p.type === 'image_url') return '[image]';
      return JSON.stringify(p);
    }).join('\n');
  }
  return JSON.stringify(content);
}

function messageTokenEstimate(m, modelId) {
  let text = contentToString(m.content);
  if (m.tool_calls?.length) {
    text += `\n${JSON.stringify(m.tool_calls)}`;
  }
  return estimateTokens(text, modelId);
}

function attachToolCalls(history, toolCalls) {
  const byMsg = {};
  toolCalls.forEach((tc) => {
    if (!byMsg[tc.message_id]) byMsg[tc.message_id] = [];
    byMsg[tc.message_id].push(tc);
  });
  return history.map((m) => ({
    ...m,
    tool_calls: byMsg[m.message_id] || [],
  }));
}

function analyzeMessages(messages, modelId) {
  let summarized = 0;
  let conversation = 0;
  let attachments = 0;

  messages.forEach((m) => {
    const text = contentToString(m.content);
    const tokens = messageTokenEstimate(m, modelId);
    if (m.role === 'system' && text.startsWith('Summary of earlier conversation')) {
      summarized += tokens;
      return;
    }
    if (m.role === 'system') return;
    if (text.includes('[image') || (Array.isArray(m.content) && m.content.some((p) => p.type === 'image' || p.type === 'image_url'))) {
      attachments += tokens;
      return;
    }
    conversation += tokens;
  });

  return { summarized, conversation, attachments };
}

function estimateToolsTokens(modelMeta) {
  const tools = modelMeta.provider === 'anthropic'
    ? toAnthropicTools(TOOL_DEFINITIONS)
    : toOpenAITools(TOOL_DEFINITIONS);
  return estimateTokens(JSON.stringify(tools), modelMeta.id);
}

async function computeBreakdown({
  conversation,
  userId,
  modelMeta,
  history,
  summary,
  pendingUserContent = null,
}) {
  if (!modelMeta) return null;

  const systemParts = await promptService.buildSystemPromptParts(
    userId,
    conversation.system_prompt_version,
  );

  const baseHistory = [...(history || [])];
  if (pendingUserContent) {
    baseHistory.push({ role: 'user', content: pendingUserContent });
  }

  const messages = promptService.buildMessagesForProvider(baseHistory, systemParts.full, {
    activeProvider: modelMeta.provider,
    supportsVision: modelMeta.supportsVision !== false,
    summary,
  });

  const msgSplit = analyzeMessages(messages, modelMeta.id);
  const toolsTokens = estimateToolsTokens(modelMeta);

  const parts = {
    system_prompt: estimateTokens(systemParts.base, modelMeta.id),
    business_context: estimateTokens(systemParts.businessContext, modelMeta.id),
    table_catalog: estimateTokens(systemParts.tableCatalog, modelMeta.id),
    memories: estimateTokens(systemParts.memories, modelMeta.id),
    tools: toolsTokens,
    summarized_conversation: msgSplit.summarized,
    conversation: msgSplit.conversation,
    attachments: msgSplit.attachments,
  };

  const breakdown = CATEGORIES.map((cat) => ({
    key: cat.key,
    label: cat.label,
    color: cat.color,
    tokens: parts[cat.key] || 0,
  })).filter((row) => row.tokens > 0);

  const effectiveTokens = breakdown.reduce((sum, row) => sum + row.tokens, 0);
  const limit = modelMeta.contextWindow || 128000;
  const billedTokens = (conversation.total_tokens_in || 0) + (conversation.total_tokens_out || 0);

  return {
    effectiveTokens,
    limit,
    pct: limit > 0 ? effectiveTokens / limit : 0,
    breakdown,
    estimated: true,
    billedTokens,
    maxOutputTokens: modelMeta.maxOutputTokens || null,
  };
}

async function computeForConversation(conversation, userId, { pendingUserContent = null } = {}) {
  const modelMeta = modelsRegistry.resolveModel(conversation.model_id, conversation.model_provider);
  if (!modelMeta) return null;

  let history = await MessageModel.listByConversation(conversation.conversation_id);
  const messageIds = history.map((m) => m.message_id);
  const toolCalls = messageIds.length ? await ToolCallModel.listByMessageIds(messageIds) : [];
  history = attachToolCalls(history, toolCalls);

  const summary = await ContextSummaryModel.getLatest(conversation.conversation_id);

  return computeBreakdown({
    conversation,
    userId,
    modelMeta,
    history,
    summary,
    pendingUserContent,
  });
}

module.exports = {
  CATEGORIES,
  computeBreakdown,
  computeForConversation,
  estimateTokens,
};

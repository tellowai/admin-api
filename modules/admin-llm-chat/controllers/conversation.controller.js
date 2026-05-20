'use strict';

const { v4: uuidv4 } = require('uuid');
const HTTP = require('../../core/controllers/httpcodes.server.controller').CODES;
const ConversationModel = require('../models/conversation.model');
const MessageModel = require('../models/message.model');
const ToolCallModel = require('../models/tool_call.model');
const CONSTANTS = require('../constants/admin-llm-chat.constants');
const modelsRegistry = require('../services/models.registry.service');
const ContextSummaryModel = require('../models/context.summary.model');
const contextBreakdown = require('../services/context.breakdown.service');

function parseJsonColumn(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (_e) {
    return null;
  }
}

exports.listModels = async (req, res) => {
  return res.status(HTTP.OK).json({ data: modelsRegistry.getEnabledModels() });
};

exports.listConversations = async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const cursor = req.query.cursor;
  const rows = await ConversationModel.listByUser(req.user.userId, { limit, cursor });
  return res.status(HTTP.OK).json({ data: rows });
};

exports.createConversation = async (req, res) => {
  const body = req.validatedBody;
  const model = modelsRegistry.getEnabledModels().find(
    (m) => m.id === body.model_id && m.provider === body.model_provider,
  );
  if (!model) {
    return res.status(HTTP.BAD_REQUEST).json({
      code: 'MODEL_NOT_AVAILABLE',
      message: 'Model is not configured or provider is disabled',
    });
  }
  const id = uuidv4();
  await ConversationModel.create({
    conversation_id: id,
    user_id: req.user.userId,
    title: body.title || 'New chat',
    model_provider: model.provider,
    model_id: model.id,
    system_prompt_version: body.system_prompt_version || CONSTANTS.DEFAULT_SYSTEM_PROMPT_VERSION,
    parent_conversation_id: body.parent_conversation_id || null,
    forked_from_message_id: body.forked_from_message_id || null,
  });
  const conv = await ConversationModel.getByIdForUser(id, req.user.userId);
  return res.status(HTTP.CREATED).json({ data: conv });
};

exports.getConversation = async (req, res) => {
  const conv = await ConversationModel.getByIdForUser(req.params.conversationId, req.user.userId);
  if (!conv) {
    return res.status(HTTP.NOT_FOUND).json({ code: 'CONVERSATION_NOT_FOUND' });
  }
  const messages = await MessageModel.listByConversation(req.params.conversationId);
  const messageIds = messages.map((m) => m.message_id);
  const toolCalls = await ToolCallModel.listByMessageIds(messageIds);
  const toolByMsg = {};
  toolCalls.forEach((tc) => {
    if (!toolByMsg[tc.message_id]) toolByMsg[tc.message_id] = [];
    toolByMsg[tc.message_id].push(tc);
  });
  const enriched = messages.map((m) => ({
    ...m,
    content_parts: parseJsonColumn(m.content_parts),
    tool_calls: toolByMsg[m.message_id] || [],
  }));
  const summary = await ContextSummaryModel.getLatest(req.params.conversationId);
  const contextUsage = await contextBreakdown.computeForConversation(conv, req.user.userId)
    || (() => {
      const modelMeta = modelsRegistry.resolveModel(conv.model_id, conv.model_provider);
      const effectiveTokens = (conv.total_tokens_in || 0) + (conv.total_tokens_out || 0);
      const contextLimit = modelMeta?.contextWindow || 128000;
      return {
        effectiveTokens,
        limit: contextLimit,
        pct: contextLimit > 0 ? effectiveTokens / contextLimit : 0,
        breakdown: [],
        estimated: false,
        billedTokens: effectiveTokens,
      };
    })();
  return res.status(HTTP.OK).json({
    data: {
      conversation: conv,
      messages: enriched,
      summary,
      contextUsage,
    },
  });
};

exports.patchConversation = async (req, res) => {
  const conv = await ConversationModel.getByIdForUser(req.params.conversationId, req.user.userId);
  if (!conv) return res.status(HTTP.NOT_FOUND).json({ code: 'CONVERSATION_NOT_FOUND' });
  const fields = {};
  if (req.validatedBody.title !== undefined) fields.title = req.validatedBody.title;
  if (req.validatedBody.archived_at !== undefined) fields.archived_at = req.validatedBody.archived_at;
  if (req.validatedBody.pinned_at !== undefined) fields.pinned_at = req.validatedBody.pinned_at;
  await ConversationModel.update(req.params.conversationId, req.user.userId, fields);
  const updated = await ConversationModel.getByIdForUser(req.params.conversationId, req.user.userId);
  return res.status(HTTP.OK).json({ data: updated });
};

exports.deleteConversation = async (req, res) => {
  await ConversationModel.softDelete(req.params.conversationId, req.user.userId);
  return res.status(HTTP.OK).json({ data: { deleted: true } });
};

exports.exportConversation = async (req, res) => {
  const conv = await ConversationModel.getByIdForUser(req.params.conversationId, req.user.userId);
  if (!conv) return res.status(HTTP.NOT_FOUND).json({ code: 'CONVERSATION_NOT_FOUND' });
  const messages = await MessageModel.listByConversation(req.params.conversationId);
  const format = req.query.format || 'json';
  if (format === 'md') {
    const md = messages.map((m) => `### ${m.role}\n\n${m.content || ''}\n`).join('\n');
    res.setHeader('Content-Type', 'text/markdown');
    return res.send(md);
  }
  return res.status(HTTP.OK).json({ data: { conversation: conv, messages } });
};

exports.searchConversations = async (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(HTTP.BAD_REQUEST).json({ message: 'q required' });
  const rows = await ConversationModel.search(req.user.userId, q);
  return res.status(HTTP.OK).json({ data: rows });
};

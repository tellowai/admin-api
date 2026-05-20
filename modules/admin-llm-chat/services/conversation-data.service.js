'use strict';

const MessageModel = require('../models/message.model');
const ToolCallModel = require('../models/tool_call.model');
const ContextSummaryModel = require('../models/context.summary.model');

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

function stitchToolCalls(messages, toolCalls) {
  const toolByMsg = {};
  toolCalls.forEach((tc) => {
    if (!toolByMsg[tc.message_id]) toolByMsg[tc.message_id] = [];
    toolByMsg[tc.message_id].push(tc);
  });
  return messages.map((m) => ({
    ...m,
    content_parts: parseJsonColumn(m.content_parts),
    tool_calls: toolByMsg[m.message_id] || [],
  }));
}

/** One messages query + one batched tool_calls query; stitch in memory. */
async function loadMessagesWithTools(conversationId, { limit } = {}) {
  const messages = await MessageModel.listByConversation(conversationId, { limit });
  const messageIds = messages.map((m) => m.message_id);
  const toolCalls = messageIds.length
    ? await ToolCallModel.listByMessageIds(messageIds)
    : [];
  return {
    messages: stitchToolCalls(messages, toolCalls),
    toolCalls,
  };
}

/** Parallel simple reads for conversation detail / context breakdown. */
async function loadConversationContext(conversationId) {
  const [messagePayload, summary] = await Promise.all([
    loadMessagesWithTools(conversationId),
    ContextSummaryModel.getLatest(conversationId),
  ]);
  return {
    messages: messagePayload.messages,
    toolCalls: messagePayload.toolCalls,
    summary,
  };
}

module.exports = {
  parseJsonColumn,
  stitchToolCalls,
  loadMessagesWithTools,
  loadConversationContext,
};

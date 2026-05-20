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
async function loadMessagesWithTools(conversationId, { paginate, limit, beforeSequenceNo } = {}) {
  const messages = paginate
    ? await MessageModel.listPageByConversation(conversationId, { limit, beforeSequenceNo })
    : await MessageModel.listByConversation(conversationId);
  const messageIds = messages.map((m) => m.message_id);
  const toolCalls = messageIds.length
    ? await ToolCallModel.listByMessageIds(messageIds)
    : [];
  return {
    messages: stitchToolCalls(messages, toolCalls),
    toolCalls,
  };
}

async function buildMessagesPagination(conversationId, messages, { limit }) {
  if (!messages.length) {
    return { hasMore: false, oldestSequenceNo: null, pageSize: limit };
  }
  const oldestSequenceNo = messages[0].sequence_no;
  const hasMore = messages.length >= limit
    && await MessageModel.hasOlderThan(conversationId, oldestSequenceNo);
  return { hasMore, oldestSequenceNo, pageSize: limit };
}

/** Paginated window for conversation detail API. */
async function loadConversationPage(conversationId, { limit, beforeSequenceNo } = {}) {
  const [messagePayload, summary] = await Promise.all([
    loadMessagesWithTools(conversationId, { paginate: true, limit, beforeSequenceNo }),
    beforeSequenceNo == null ? ContextSummaryModel.getLatest(conversationId) : Promise.resolve(undefined),
  ]);
  const pagination = await buildMessagesPagination(conversationId, messagePayload.messages, { limit });
  return {
    messages: messagePayload.messages,
    toolCalls: messagePayload.toolCalls,
    summary: summary !== undefined ? summary : null,
    pagination,
    summarySkipped: beforeSequenceNo != null,
  };
}

/** Parallel simple reads for conversation detail / context breakdown (full history). */
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
  loadConversationPage,
  loadConversationContext,
};

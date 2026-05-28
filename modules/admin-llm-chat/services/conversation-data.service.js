'use strict';

const MessageModel = require('../models/message.model');
const ToolCallModel = require('../models/tool_call.model');
const ContextSummaryModel = require('../models/context.summary.model');
const AttachmentModel = require('../models/attachment.model');
const attachmentStorage = require('./attachment.storage.service');

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

function partsArrayFromMessage(m) {
  const parts = m.content_parts;
  if (Array.isArray(parts)) return [...parts];
  if (parts && typeof parts === 'object' && Array.isArray(parts.parts)) return [...parts.parts];
  return [];
}

function mergeMessageAttachments(messages, conversationId, imageRows) {
  if (!imageRows?.length) return messages;
  const byMsg = {};
  imageRows.forEach((row) => {
    if (!byMsg[row.message_id]) byMsg[row.message_id] = [];
    byMsg[row.message_id].push({
      attachment_id: row.attachment_id,
      mime_type: row.mime_type,
      original_name: row.original_name,
      public_url: attachmentStorage.publicUrlForKey(row.storage_key),
    });
  });
  return messages.map((m) => {
    const attachments = byMsg[m.message_id];
    if (!attachments?.length) return m;
    let parts = partsArrayFromMessage(m);
    const hasImage = parts.some((p) => p?.type === 'image_url');
    if (!hasImage) {
      const text = typeof m.content === 'string' ? m.content.trim() : '';
      if (text && !parts.some((p) => p?.type === 'text')) {
        parts.unshift({ type: 'text', text });
      }
      parts = parts.concat(
        attachments.map((a) => ({
          type: 'image_url',
          image_url: { url: a.public_url },
        })),
      );
    }
    return {
      ...m,
      attachments,
      content_parts: parts.length ? parts : m.content_parts,
    };
  });
}

async function enrichMessagesWithAttachments(messages, conversationId) {
  const userIds = messages.filter((m) => m.role === 'user' && m.message_id).map((m) => m.message_id);
  if (!userIds.length) return messages;
  const imageRows = await AttachmentModel.listImagesByMessageIds(conversationId, userIds);
  return mergeMessageAttachments(messages, conversationId, imageRows);
}

/** Paginated window for conversation detail API. */
async function loadConversationPage(conversationId, { limit, beforeSequenceNo } = {}) {
  const [messagePayload, summary] = await Promise.all([
    loadMessagesWithTools(conversationId, { paginate: true, limit, beforeSequenceNo }),
    beforeSequenceNo == null ? ContextSummaryModel.getLatest(conversationId) : Promise.resolve(undefined),
  ]);
  const pagination = await buildMessagesPagination(conversationId, messagePayload.messages, { limit });
  const messages = await enrichMessagesWithAttachments(messagePayload.messages, conversationId);
  return {
    messages,
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
  enrichMessagesWithAttachments,
};

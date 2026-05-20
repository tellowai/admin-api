'use strict';

const AttachmentModel = require('../models/attachment.model');
const attachmentStorage = require('./attachment.storage.service');
const CONSTANTS = require('../constants/admin-llm-chat.constants');

/**
 * Build user message content + content_parts from registered attachments.
 */
async function resolveAttachmentsForTurn(attachmentIds, userId, conversationId, {
  userText = '',
  supportsVision = true,
} = {}) {
  if (!attachmentIds?.length) {
    return { content: userText, content_parts: null };
  }

  const attachments = await AttachmentModel.listByIdsForUser(attachmentIds, userId);
  const valid = attachments.filter((a) => a.conversation_id === conversationId);
  if (valid.length !== attachmentIds.length) {
    const err = new Error('One or more attachments are invalid for this conversation');
    err.code = 'INVALID_ATTACHMENTS';
    throw err;
  }

  const textBlocks = [];
  const trimmed = String(userText || '').trim();
  if (trimmed) textBlocks.push(trimmed);

  const imageParts = [];
  for (const att of valid) {
    const mime = att.mime_type || '';
    if (mime.startsWith('image/') && supportsVision) {
      imageParts.push({
        type: 'image_url',
        image_url: { url: attachmentStorage.publicUrlForKey(att.storage_key) },
      });
      continue;
    }
    if (att.parsed_text) {
      textBlocks.push(`[File: ${att.original_name || 'attachment'}]\n${att.parsed_text}`);
    } else {
      textBlocks.push(`[File attached: ${att.original_name || att.attachment_id} (${mime || 'unknown'}) — text not extracted yet]`);
    }
  }

  const combinedText = textBlocks.join('\n\n');
  if (imageParts.length) {
    const parts = [];
    if (combinedText) parts.push({ type: 'text', text: combinedText });
    parts.push(...imageParts);
    return { content: parts, content_parts: parts };
  }

  return { content: combinedText || userText, content_parts: null };
}

module.exports = {
  resolveAttachmentsForTurn,
};

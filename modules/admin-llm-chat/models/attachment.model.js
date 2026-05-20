'use strict';

const mysqlModel = require('../../core/models/mysql.promise.model');

exports.create = (data) => {
  const q = `INSERT INTO admin_llm_chat_attachments
    (attachment_id, conversation_id, message_id, user_id, mime_type, size_bytes, storage_key, original_name, parse_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  return mysqlModel.runQueryInMaster(q, [
    data.attachment_id,
    data.conversation_id,
    data.message_id || null,
    data.user_id,
    data.mime_type,
    data.size_bytes,
    data.storage_key,
    data.original_name,
    data.parse_status || 'pending',
  ]);
};

exports.getByIdForUser = (attachmentId, userId) => {
  const q = `SELECT attachment_id, conversation_id, message_id, user_id, mime_type, size_bytes,
    storage_key, original_name, parse_status, parsed_text, created_at
    FROM admin_llm_chat_attachments WHERE attachment_id = ? AND user_id = ? LIMIT 1`;
  return mysqlModel.runQueryInSlave(q, [attachmentId, userId]).then((r) => r[0] || null);
};

exports.updateParse = (attachmentId, parsedText, parseStatus) => {
  const q = `UPDATE admin_llm_chat_attachments SET parsed_text = ?, parse_status = ? WHERE attachment_id = ?`;
  return mysqlModel.runQueryInMaster(q, [parsedText, parseStatus, attachmentId]);
};

exports.linkToMessage = (attachmentIds, messageId) => {
  if (!attachmentIds.length) return Promise.resolve();
  const placeholders = attachmentIds.map(() => '?').join(',');
  const q = `UPDATE admin_llm_chat_attachments SET message_id = ? WHERE attachment_id IN (${placeholders})`;
  return mysqlModel.runQueryInMaster(q, [messageId, ...attachmentIds]);
};

exports.listByConversation = (conversationId) => {
  const q = `SELECT attachment_id, conversation_id, message_id, mime_type, size_bytes,
    storage_key, original_name, parse_status, created_at
    FROM admin_llm_chat_attachments WHERE conversation_id = ? ORDER BY created_at ASC`;
  return mysqlModel.runQueryInSlave(q, [conversationId]);
};

exports.listByIdsForUser = (attachmentIds, userId) => {
  if (!attachmentIds.length) return Promise.resolve([]);
  const placeholders = attachmentIds.map(() => '?').join(',');
  const q = `SELECT attachment_id, conversation_id, message_id, mime_type, size_bytes,
    storage_key, original_name, parse_status, parsed_text
    FROM admin_llm_chat_attachments
    WHERE user_id = ? AND attachment_id IN (${placeholders})`;
  return mysqlModel.runQueryInSlave(q, [userId, ...attachmentIds]);
};

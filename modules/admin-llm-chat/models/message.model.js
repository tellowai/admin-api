'use strict';

const mysqlModel = require('../../core/models/mysql.promise.model');

exports.create = (data) => {
  const q = `INSERT INTO admin_llm_chat_messages
    (message_id, conversation_id, turn_id, client_message_id, role, content, content_parts,
     model_provider, model_id, sequence_no, tokens_in, tokens_out, cost_usd, latency_ms, finish_reason, is_hidden)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  return mysqlModel.runQueryInMaster(q, [
    data.message_id,
    data.conversation_id,
    data.turn_id || null,
    data.client_message_id || null,
    data.role,
    data.content || null,
    data.content_parts ? JSON.stringify(data.content_parts) : null,
    data.model_provider || null,
    data.model_id || null,
    data.sequence_no,
    data.tokens_in || 0,
    data.tokens_out || 0,
    data.cost_usd || 0,
    data.latency_ms || null,
    data.finish_reason || null,
    data.is_hidden ? 1 : 0,
  ]);
};

const MESSAGE_LIST_COLUMNS = `message_id, conversation_id, turn_id, client_message_id, role, content, content_parts,
    model_provider, model_id, sequence_no, tokens_in, tokens_out, cost_usd, latency_ms, finish_reason, created_at`;

/** Full history ascending (orchestrator, export, context breakdown). */
exports.listByConversation = (conversationId) => {
  const q = `SELECT ${MESSAGE_LIST_COLUMNS}
    FROM admin_llm_chat_messages
    WHERE conversation_id = ? AND is_hidden = 0
    ORDER BY sequence_no ASC`;
  return mysqlModel.runQueryInSlave(q, [conversationId]);
};

/** Recent page for chat UI: latest N, or N older than beforeSequenceNo. Returns ascending order. */
exports.listPageByConversation = (conversationId, { limit = 10, beforeSequenceNo = null } = {}) => {
  const lim = Math.min(Math.max(1, parseInt(limit, 10) || 10), 100);
  if (beforeSequenceNo != null && Number.isFinite(Number(beforeSequenceNo))) {
    const q = `SELECT ${MESSAGE_LIST_COLUMNS}
      FROM admin_llm_chat_messages
      WHERE conversation_id = ? AND is_hidden = 0 AND sequence_no < ?
      ORDER BY sequence_no DESC
      LIMIT ?`;
    return mysqlModel.runQueryInSlave(q, [conversationId, beforeSequenceNo, lim])
      .then((rows) => rows.reverse());
  }
  const q = `SELECT ${MESSAGE_LIST_COLUMNS}
    FROM admin_llm_chat_messages
    WHERE conversation_id = ? AND is_hidden = 0
    ORDER BY sequence_no DESC
    LIMIT ?`;
  return mysqlModel.runQueryInSlave(q, [conversationId, lim])
    .then((rows) => rows.reverse());
};

exports.hasOlderThan = (conversationId, sequenceNo) => {
  const q = `SELECT 1 AS ok FROM admin_llm_chat_messages
    WHERE conversation_id = ? AND is_hidden = 0 AND sequence_no < ?
    LIMIT 1`;
  return mysqlModel.runQueryInSlave(q, [conversationId, sequenceNo])
    .then((rows) => rows.length > 0);
};

exports.getById = (messageId) => {
  const q = `SELECT * FROM admin_llm_chat_messages WHERE message_id = ? LIMIT 1`;
  return mysqlModel.runQueryInSlave(q, [messageId]).then((rows) => rows[0] || null);
};

exports.findByClientMessageId = (conversationId, clientMessageId) => {
  if (!clientMessageId) return Promise.resolve(null);
  const q = `SELECT message_id, role, content, finish_reason FROM admin_llm_chat_messages
    WHERE conversation_id = ? AND client_message_id = ? LIMIT 1`;
  return mysqlModel.runQueryInSlave(q, [conversationId, clientMessageId]).then((rows) => rows[0] || null);
};

exports.nextSequenceNo = async (conversationId) => {
  const q = `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_seq
    FROM admin_llm_chat_messages WHERE conversation_id = ?`;
  const rows = await mysqlModel.runQueryInMaster(q, [conversationId]);
  return rows[0].next_seq;
};

exports.createMany = (rows) => {
  if (!rows.length) return Promise.resolve();
  const valuePlaceholders = rows.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
  const q = `INSERT INTO admin_llm_chat_messages
    (message_id, conversation_id, turn_id, client_message_id, role, content, content_parts,
     model_provider, model_id, sequence_no, tokens_in, tokens_out, cost_usd, latency_ms, finish_reason, is_hidden)
    VALUES ${valuePlaceholders}`;
  const params = [];
  rows.forEach((data) => {
    params.push(
      data.message_id,
      data.conversation_id,
      data.turn_id || null,
      data.client_message_id || null,
      data.role,
      data.content || null,
      data.content_parts ? JSON.stringify(data.content_parts) : null,
      data.model_provider || null,
      data.model_id || null,
      data.sequence_no,
      data.tokens_in || 0,
      data.tokens_out || 0,
      data.cost_usd || 0,
      data.latency_ms || null,
      data.finish_reason || null,
      data.is_hidden ? 1 : 0,
    );
  });
  return mysqlModel.runQueryInMaster(q, params);
};

exports.updateContent = (messageId, content, finishReason) => {
  const q = `UPDATE admin_llm_chat_messages SET content = ?, finish_reason = ? WHERE message_id = ?`;
  return mysqlModel.runQueryInMaster(q, [content, finishReason, messageId]);
};

exports.finalize = (messageId, data) => {
  const q = `UPDATE admin_llm_chat_messages SET
    content = ?, content_parts = ?, finish_reason = ?,
    tokens_in = ?, tokens_out = ?, cost_usd = ?, latency_ms = ?
    WHERE message_id = ?`;
  return mysqlModel.runQueryInMaster(q, [
    data.content || null,
    data.content_parts ? JSON.stringify(data.content_parts) : null,
    data.finish_reason || 'stop',
    data.tokens_in || 0,
    data.tokens_out || 0,
    data.cost_usd || 0,
    data.latency_ms || null,
    messageId,
  ]);
};

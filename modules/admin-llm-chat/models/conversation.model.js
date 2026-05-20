'use strict';

const mysqlModel = require('../../core/models/mysql.promise.model');

exports.create = (data) => {
  const q = `INSERT INTO admin_llm_chat_conversations
    (conversation_id, user_id, title, model_provider, model_id, system_prompt_version, parent_conversation_id, forked_from_message_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  return mysqlModel.runQueryInMaster(q, [
    data.conversation_id,
    data.user_id,
    data.title || null,
    data.model_provider,
    data.model_id,
    data.system_prompt_version || 'v1',
    data.parent_conversation_id || null,
    data.forked_from_message_id || null,
  ]);
};

exports.listByUser = (userId, { limit = 50, cursor }) => {
  let q = `SELECT conversation_id, user_id, title, model_provider, model_id, pinned_at,
    total_tokens_in, total_tokens_out, total_cost_usd, created_at, updated_at, archived_at
    FROM admin_llm_chat_conversations
    WHERE user_id = ? AND deleted_at IS NULL`;
  const params = [userId];
  if (cursor) {
    q += ' AND updated_at < ?';
    params.push(cursor);
  }
  q += ' ORDER BY pinned_at IS NULL, pinned_at DESC, updated_at DESC LIMIT ?';
  params.push(limit);
  return mysqlModel.runQueryInSlave(q, params);
};

exports.getByIdForUser = (conversationId, userId) => {
  const q = `SELECT * FROM admin_llm_chat_conversations
    WHERE conversation_id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`;
  return mysqlModel.runQueryInSlave(q, [conversationId, userId]).then((rows) => rows[0] || null);
};

exports.update = (conversationId, userId, fields) => {
  const sets = [];
  const params = [];
  Object.entries(fields).forEach(([k, v]) => {
    sets.push(`${k} = ?`);
    params.push(v);
  });
  if (!sets.length) return Promise.resolve();
  params.push(conversationId, userId);
  const q = `UPDATE admin_llm_chat_conversations SET ${sets.join(', ')}
    WHERE conversation_id = ? AND user_id = ? AND deleted_at IS NULL`;
  return mysqlModel.runQueryInMaster(q, params);
};

exports.softDelete = (conversationId, userId) => {
  const q = `UPDATE admin_llm_chat_conversations SET deleted_at = NOW()
    WHERE conversation_id = ? AND user_id = ?`;
  return mysqlModel.runQueryInMaster(q, [conversationId, userId]);
};

exports.updateModel = (conversationId, userId, provider, modelId) => {
  const q = `UPDATE admin_llm_chat_conversations SET model_provider = ?, model_id = ?, updated_at = NOW()
    WHERE conversation_id = ? AND user_id = ? AND deleted_at IS NULL`;
  return mysqlModel.runQueryInMaster(q, [provider, modelId, conversationId, userId]);
};

exports.addUsageTotals = (conversationId, tokensIn, tokensOut, costUsd) => {
  const q = `UPDATE admin_llm_chat_conversations SET
    total_tokens_in = total_tokens_in + ?,
    total_tokens_out = total_tokens_out + ?,
    total_cost_usd = total_cost_usd + ?,
    updated_at = NOW()
    WHERE conversation_id = ?`;
  return mysqlModel.runQueryInMaster(q, [tokensIn, tokensOut, costUsd, conversationId]);
};

exports.search = (userId, query, limit = 20) => {
  const q = `SELECT conversation_id, title, updated_at,
    MATCH(title, content_searchable) AGAINST (? IN NATURAL LANGUAGE MODE) AS score
    FROM admin_llm_chat_conversations
    WHERE user_id = ? AND deleted_at IS NULL
    AND MATCH(title, content_searchable) AGAINST (? IN NATURAL LANGUAGE MODE)
    ORDER BY score DESC LIMIT ?`;
  return mysqlModel.runQueryInSlave(q, [query, userId, query, limit]);
};

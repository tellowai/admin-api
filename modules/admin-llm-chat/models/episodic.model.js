'use strict';

const mysqlModel = require('../../core/models/mysql.promise.model');

const ACTIVE_FILTER = 'deleted_at IS NULL';

function isSchemaMismatchError(err) {
  const msg = String(err?.originalMessage || err?.message || '');
  return msg.includes('Unknown column') || msg.includes("doesn't exist");
}

exports.listByUser = async (userId, { limit = 50 } = {}) => {
  const q = `SELECT episodic_id, user_id, conversation_id, summary_text, topics_json,
    embedding_json, embedding_model, through_message_id, created_at, updated_at
    FROM admin_llm_chat_episodic_memory
    WHERE user_id = ? AND ${ACTIVE_FILTER}
    ORDER BY created_at DESC
    LIMIT ?`;
  try {
    return await mysqlModel.runQueryInSlave(q, [userId, limit]);
  } catch (err) {
    if (isSchemaMismatchError(err)) return [];
    throw err;
  }
};

exports.listByConversation = async (conversationId) => {
  const q = `SELECT episodic_id, user_id, conversation_id, summary_text, topics_json,
    embedding_json, embedding_model, through_message_id, created_at, updated_at
    FROM admin_llm_chat_episodic_memory
    WHERE conversation_id = ? AND ${ACTIVE_FILTER}
    ORDER BY created_at DESC`;
  try {
    return await mysqlModel.runQueryInSlave(q, [conversationId]);
  } catch (err) {
    if (isSchemaMismatchError(err)) return [];
    throw err;
  }
};

exports.insert = async (data) => {
  const q = `INSERT INTO admin_llm_chat_episodic_memory (
      episodic_id, user_id, conversation_id, summary_text, topics_json,
      embedding_json, embedding_model, through_message_id
    ) VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)`;
  try {
    return await mysqlModel.runQueryInMaster(q, [
      data.user_id,
      data.conversation_id,
      data.summary_text,
      data.topics_json ? JSON.stringify(data.topics_json) : null,
      data.embedding_json ? JSON.stringify(data.embedding_json) : null,
      data.embedding_model || null,
      data.through_message_id || null,
    ]);
  } catch (err) {
    if (isSchemaMismatchError(err)) return null;
    throw err;
  }
};

exports.softDelete = async (userId, episodicId) => {
  const q = `UPDATE admin_llm_chat_episodic_memory SET deleted_at = NOW()
    WHERE user_id = ? AND episodic_id = ? AND deleted_at IS NULL`;
  try {
    return await mysqlModel.runQueryInMaster(q, [userId, episodicId]);
  } catch (err) {
    if (isSchemaMismatchError(err)) return null;
    throw err;
  }
};

exports.purgeForUser = async (userId) => {
  const q = `UPDATE admin_llm_chat_episodic_memory SET deleted_at = NOW()
    WHERE user_id = ? AND deleted_at IS NULL`;
  try {
    return await mysqlModel.runQueryInMaster(q, [userId]);
  } catch (err) {
    if (isSchemaMismatchError(err)) return null;
    throw err;
  }
};

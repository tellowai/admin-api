'use strict';

const mysqlModel = require('../../core/models/mysql.promise.model');

/** Cached after first probe — avoids repeated failed extended queries on legacy schema. */
let extendedSchemaAvailable = null;

function isSchemaMismatchError(err) {
  const msg = String(err?.originalMessage || err?.message || '');
  return msg.includes('Unknown column') || msg.includes("doesn't exist");
}

async function probeExtendedSchema() {
  if (extendedSchemaAvailable !== null) return extendedSchemaAvailable;
  try {
    await mysqlModel.runQueryInSlave(
      'SELECT memory_type FROM admin_llm_chat_user_memory LIMIT 0',
      [],
    );
    extendedSchemaAvailable = true;
  } catch (err) {
    if (isSchemaMismatchError(err)) {
      extendedSchemaAvailable = false;
    } else {
      throw err;
    }
  }
  return extendedSchemaAvailable;
}

exports.listByUser = async (userId) => {
  const hasExtended = await probeExtendedSchema();
  if (!hasExtended) {
    const legacyQ = `SELECT memory_key, memory_value, updated_at
      FROM admin_llm_chat_user_memory
      WHERE user_id = ?
      ORDER BY updated_at DESC`;
    return mysqlModel.runQueryInSlave(legacyQ, [userId]);
  }
  const q = `SELECT memory_id, memory_key, memory_value, memory_type, embedding_json, embedding_model,
    source_conversation_id, metadata_json, expires_at, created_at, updated_at
    FROM admin_llm_chat_user_memory
    WHERE user_id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY updated_at DESC`;
  return mysqlModel.runQueryInSlave(q, [userId]);
};

exports.getByKeyForUser = async (userId, key) => {
  const hasExtended = await probeExtendedSchema();
  if (!hasExtended) {
    const legacyQ = `SELECT memory_key, memory_value, updated_at
      FROM admin_llm_chat_user_memory WHERE user_id = ? AND memory_key = ? LIMIT 1`;
    const rows = await mysqlModel.runQueryInSlave(legacyQ, [userId, key]);
    return rows[0] || null;
  }
  const q = `SELECT memory_id, memory_key, memory_value, memory_type, embedding_json, embedding_model,
    source_conversation_id, metadata_json, expires_at, created_at, updated_at
    FROM admin_llm_chat_user_memory
    WHERE user_id = ? AND memory_key = ? AND deleted_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
    LIMIT 1`;
  const rows = await mysqlModel.runQueryInSlave(q, [userId, key]);
  return rows[0] || null;
};

exports.upsertMemory = async (userId, key, value, extras = {}) => {
  const rows = await exports.upsertMany([{ userId, key, value, extras }]);
  return rows;
};

/** Batch upsert — one query for N memories (no per-item loop queries). */
exports.upsertMany = async (items) => {
  if (!items?.length) return [];
  const hasExtended = await probeExtendedSchema();

  if (!hasExtended) {
    const legacyQ = `INSERT INTO admin_llm_chat_user_memory (memory_id, user_id, memory_key, memory_value)
      VALUES ${items.map(() => '(UUID(), ?, ?, ?)').join(',')}
      ON DUPLICATE KEY UPDATE memory_value = VALUES(memory_value), updated_at = NOW()`;
    const params = [];
    items.forEach((item) => {
      params.push(item.userId, item.key, item.value);
    });
    await mysqlModel.runQueryInMaster(legacyQ, params);
    return items;
  }

  const rowPlaceholder = '(UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)';
  const q = `INSERT INTO admin_llm_chat_user_memory (
      memory_id, user_id, memory_key, memory_value, memory_type,
      embedding_json, embedding_model, source_conversation_id, metadata_json, expires_at, deleted_at
    ) VALUES ${items.map(() => rowPlaceholder).join(',')}
    ON DUPLICATE KEY UPDATE
      memory_value = VALUES(memory_value),
      memory_type = VALUES(memory_type),
      embedding_json = VALUES(embedding_json),
      embedding_model = VALUES(embedding_model),
      source_conversation_id = COALESCE(VALUES(source_conversation_id), source_conversation_id),
      metadata_json = COALESCE(VALUES(metadata_json), metadata_json),
      expires_at = VALUES(expires_at),
      deleted_at = NULL,
      updated_at = NOW()`;
  const params = [];
  items.forEach((item) => {
    const {
      memoryType = 'semantic',
      embeddingJson = null,
      embeddingModel = null,
      sourceConversationId = null,
      metadataJson = null,
      expiresAt = null,
    } = item.extras || {};
    params.push(
      item.userId,
      item.key,
      item.value,
      memoryType,
      embeddingJson ? JSON.stringify(embeddingJson) : null,
      embeddingModel,
      sourceConversationId,
      metadataJson ? JSON.stringify(metadataJson) : null,
      expiresAt,
    );
  });
  await mysqlModel.runQueryInMaster(q, params);
  return items;
};

exports.softDeleteMemory = async (userId, key) => {
  const hasExtended = await probeExtendedSchema();
  if (!hasExtended) {
    const legacyQ = `DELETE FROM admin_llm_chat_user_memory WHERE user_id = ? AND memory_key = ?`;
    return mysqlModel.runQueryInMaster(legacyQ, [userId, key]);
  }
  const q = `UPDATE admin_llm_chat_user_memory SET deleted_at = NOW()
    WHERE user_id = ? AND memory_key = ? AND deleted_at IS NULL`;
  return mysqlModel.runQueryInMaster(q, [userId, key]);
};

exports.deleteMemory = (userId, key) => exports.softDeleteMemory(userId, key);

exports.purgeForUser = async (userId) => {
  const hasExtended = await probeExtendedSchema();
  if (!hasExtended) {
    const legacyQ = `DELETE FROM admin_llm_chat_user_memory WHERE user_id = ?`;
    return mysqlModel.runQueryInMaster(legacyQ, [userId]);
  }
  const q = `UPDATE admin_llm_chat_user_memory SET deleted_at = NOW()
    WHERE user_id = ? AND deleted_at IS NULL`;
  return mysqlModel.runQueryInMaster(q, [userId]);
};

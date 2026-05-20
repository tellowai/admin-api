'use strict';

const mysqlModel = require('../../core/models/mysql.promise.model');

exports.listByUser = (userId) => {
  const q = `SELECT memory_key, memory_value, updated_at FROM admin_llm_chat_user_memory WHERE user_id = ? ORDER BY updated_at DESC`;
  return mysqlModel.runQueryInSlave(q, [userId]);
};

exports.upsertMemory = (userId, key, value) => {
  const q = `INSERT INTO admin_llm_chat_user_memory (memory_id, user_id, memory_key, memory_value)
    VALUES (UUID(), ?, ?, ?)
    ON DUPLICATE KEY UPDATE memory_value = VALUES(memory_value), updated_at = NOW()`;
  return mysqlModel.runQueryInMaster(q, [userId, key, value]);
};

exports.deleteMemory = (userId, key) => {
  const q = `DELETE FROM admin_llm_chat_user_memory WHERE user_id = ? AND memory_key = ?`;
  return mysqlModel.runQueryInMaster(q, [userId, key]);
};

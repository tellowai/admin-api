'use strict';

const mysqlModel = require('../../core/models/mysql.promise.model');

exports.create = (data) => {
  const q = `INSERT INTO admin_llm_chat_tool_calls
    (tool_call_id, message_id, tool_name, arguments_json, result_json, status, duration_ms, rows_returned, error_code, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  return mysqlModel.runQueryInMaster(q, [
    data.tool_call_id,
    data.message_id,
    data.tool_name,
    JSON.stringify(data.arguments_json || {}),
    data.result_json ? String(data.result_json).slice(0, 65000) : null,
    data.status || 'completed',
    data.duration_ms || null,
    data.rows_returned || null,
    data.error_code || null,
    data.error_message || null,
  ]);
};

exports.listByMessageIds = (messageIds) => {
  if (!messageIds.length) return Promise.resolve([]);
  const placeholders = messageIds.map(() => '?').join(',');
  const q = `SELECT tool_call_id, message_id, tool_name, arguments_json, result_json, status,
    duration_ms, rows_returned, error_code, error_message, created_at
    FROM admin_llm_chat_tool_calls WHERE message_id IN (${placeholders})`;
  return mysqlModel.runQueryInSlave(q, messageIds);
};

exports.createMany = (rows) => {
  if (!rows.length) return Promise.resolve();
  const valuePlaceholders = rows.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
  const q = `INSERT INTO admin_llm_chat_tool_calls
    (tool_call_id, message_id, tool_name, arguments_json, result_json, status, duration_ms, rows_returned, error_code, error_message)
    VALUES ${valuePlaceholders}`;
  const params = [];
  rows.forEach((data) => {
    params.push(
      data.tool_call_id,
      data.message_id,
      data.tool_name,
      JSON.stringify(data.arguments_json || {}),
      data.result_json ? String(data.result_json).slice(0, 65000) : null,
      data.status || 'completed',
      data.duration_ms || null,
      data.rows_returned || null,
      data.error_code || null,
      data.error_message || null,
    );
  });
  return mysqlModel.runQueryInMaster(q, params);
};

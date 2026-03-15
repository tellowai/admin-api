'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.listByModel = async function (platformModelId) {
  const query = `
    SELECT pc.*, m.name as model_name
    FROM ai_model_preprocess_configs pc
    LEFT JOIN ai_model_registry m ON pc.platform_model_id = m.platform_model_id AND m.status = 'active'
    WHERE pc.platform_model_id = ?
    ORDER BY pc.priority DESC, pc.config_type ASC
  `;
  return mysqlQueryRunner.runQueryInSlave(query, [platformModelId]);
};

exports.listAll = async function (filters = {}) {
  let query = `
    SELECT pc.*, m.name as model_name
    FROM ai_model_preprocess_configs pc
    LEFT JOIN ai_model_registry m ON pc.platform_model_id = m.platform_model_id AND m.status = 'active'
    WHERE 1=1
  `;
  const params = [];
  if (filters.platform_model_id) {
    query += ' AND pc.platform_model_id = ?';
    params.push(filters.platform_model_id);
  }
  if (filters.config_type) {
    query += ' AND pc.config_type = ?';
    params.push(filters.config_type);
  }
  if (filters.is_active !== undefined && filters.is_active !== null) {
    query += ' AND pc.is_active = ?';
    params.push(filters.is_active ? 1 : 0);
  }
  query += ' ORDER BY pc.platform_model_id, pc.priority DESC, pc.config_type ASC';
  return mysqlQueryRunner.runQueryInSlave(query, params);
};

exports.getById = async function (id) {
  const rows = await mysqlQueryRunner.runQueryInSlave(
    `SELECT pc.*, m.name as model_name
     FROM ai_model_preprocess_configs pc
     LEFT JOIN ai_model_registry m ON pc.platform_model_id = m.platform_model_id AND m.status = 'active'
     WHERE pc.id = ?`,
    [id]
  );
  return rows?.[0] || null;
};

exports.create = async function (data) {
  const query = `
    INSERT INTO ai_model_preprocess_configs
    (platform_model_id, config_type, title, content_text, content_json, is_active, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    data.platform_model_id,
    data.config_type,
    data.title || null,
    data.content_text || null,
    data.content_json ? JSON.stringify(data.content_json) : null,
    data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
    data.priority ?? 0,
  ];
  const result = await mysqlQueryRunner.runQueryInMaster(query, params);
  return result.insertId;
};

exports.update = async function (id, data) {
  const allowed = ['title', 'content_text', 'content_json', 'is_active', 'priority'];
  const updates = [];
  const params = [];
  allowed.forEach(k => {
    if (data[k] !== undefined) {
      if (k === 'is_active') {
        updates.push(`${k} = ?`);
        params.push(data[k] ? 1 : 0);
      } else if (k === 'content_json') {
        updates.push(`${k} = ?`);
        params.push(data[k] ? JSON.stringify(data[k]) : null);
      } else {
        updates.push(`${k} = ?`);
        params.push(data[k]);
      }
    }
  });
  if (updates.length === 0) return 0;
  params.push(id);
  const result = await mysqlQueryRunner.runQueryInMaster(
    `UPDATE ai_model_preprocess_configs SET ${updates.join(', ')} WHERE id = ?`,
    params
  );
  return result.affectedRows;
};

exports.remove = async function (id) {
  const result = await mysqlQueryRunner.runQueryInMaster(
    'DELETE FROM ai_model_preprocess_configs WHERE id = ?',
    [id]
  );
  return result.affectedRows;
};

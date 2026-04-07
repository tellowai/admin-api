'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { v4: uuidv4 } = require('uuid');

exports.getFormatters = async function(resourceKey) {
  const query = `
    SELECT * FROM sdui_formatters
    WHERE resource_key = ? AND is_active = 1
    ORDER BY sort_order ASC
  `;
  const result = await mysqlQueryRunner.runQueryInSlave(query, [resourceKey]);
  return result.map(row => ({
    ...row,
    config_json: row.config_json ? (typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json) : {}
  }));
};

exports.createFormatter = async function(data) {
  const id = uuidv4();
  const query = `
    INSERT INTO sdui_formatters 
    (id, resource_key, formatter_name, target_field, formatter_type, config_json, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    id,
    data.resource_key,
    data.formatter_name,
    data.target_field,
    data.formatter_type,
    JSON.stringify(data.config_json || {}),
    data.sort_order || 0,
    data.is_active !== false ? 1 : 0
  ];

  await mysqlQueryRunner.runQueryInMaster(query, params);
  return id;
};

exports.updateFormatter = async function(id, data) {
  const updates = [];
  const params = [];

  const updateableFields = ['formatter_name', 'target_field', 'formatter_type', 'config_json', 'sort_order', 'is_active'];

  updateableFields.forEach(field => {
    if (data[field] !== undefined) {
      updates.push(`${field} = ?`);
      if (field === 'config_json') {
        params.push(JSON.stringify(data[field]));
      } else if (field === 'is_active') {
        params.push(data[field] ? 1 : 0);
      } else {
        params.push(data[field]);
      }
    }
  });

  if (updates.length === 0) return false;

  const query = `UPDATE sdui_formatters SET ${updates.join(', ')} WHERE id = ?`;
  params.push(id);

  const result = await mysqlQueryRunner.runQueryInMaster(query, params);
  return result.affectedRows > 0;
};

exports.deleteFormatter = async function(id) {
  const query = `UPDATE sdui_formatters SET is_active = 0 WHERE id = ?`;
  const result = await mysqlQueryRunner.runQueryInMaster(query, [id]);
  return result.affectedRows > 0;
};

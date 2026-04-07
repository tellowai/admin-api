'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { v4: uuidv4 } = require('uuid');

exports.getDataBindingsForEntity = async function(entityType, entityId) {
  const query = `
    SELECT * FROM sdui_screen_data_bindings
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY sort_order ASC
  `;
  const result = await mysqlQueryRunner.runQueryInSlave(query, [entityType, entityId]);
  return result.map(row => ({
    ...row,
    fetch_config_json: row.fetch_config_json ? (typeof row.fetch_config_json === 'string' ? JSON.parse(row.fetch_config_json) : row.fetch_config_json) : null,
    merge_state_json: row.merge_state_json ? (typeof row.merge_state_json === 'string' ? JSON.parse(row.merge_state_json) : row.merge_state_json) : null
  }));
};

exports.createDataBinding = async function(data) {
  const id = uuidv4();
  const query = `
    INSERT INTO sdui_screen_data_bindings 
    (id, entity_type, entity_id, resource_key, binding_alias, fetch_on, fetch_config_json, merge_state_json, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    id,
    data.entity_type,
    data.entity_id,
    data.resource_key,
    data.binding_alias,
    data.fetch_on || 'load',
    data.fetch_config_json ? JSON.stringify(data.fetch_config_json) : null,
    data.merge_state_json ? JSON.stringify(data.merge_state_json) : null,
    data.sort_order || 0
  ];

  await mysqlQueryRunner.runQueryInMaster(query, params);
  return id;
};

exports.updateDataBinding = async function(id, data) {
  const updates = [];
  const params = [];

  const updateableFields = ['resource_key', 'binding_alias', 'fetch_on', 'fetch_config_json', 'merge_state_json', 'sort_order'];

  updateableFields.forEach(field => {
    if (data[field] !== undefined) {
      updates.push(`${field} = ?`);
      if (['fetch_config_json', 'merge_state_json'].includes(field)) {
        params.push(data[field] ? JSON.stringify(data[field]) : null);
      } else {
        params.push(data[field]);
      }
    }
  });

  if (updates.length === 0) return false;

  const query = `UPDATE sdui_screen_data_bindings SET ${updates.join(', ')} WHERE id = ?`;
  params.push(id);

  const result = await mysqlQueryRunner.runQueryInMaster(query, params);
  return result.affectedRows > 0;
};

exports.deleteDataBinding = async function(id) {
  const query = `DELETE FROM sdui_screen_data_bindings WHERE id = ?`;
  const result = await mysqlQueryRunner.runQueryInMaster(query, [id]);
  return result.affectedRows > 0;
};

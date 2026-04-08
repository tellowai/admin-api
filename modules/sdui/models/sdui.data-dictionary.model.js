'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { v4: uuidv4 } = require('uuid');

exports.listDataDictionaryFields = async function(resourceKey = null) {
  let query = `
    SELECT * FROM sdui_data_dictionary
    WHERE is_active = 1
  `;
  const params = [];

  if (resourceKey) {
    query += ` AND resource_key = ?`;
    params.push(resourceKey);
  }

  query += ` ORDER BY resource_key, sort_order ASC`;

  return mysqlQueryRunner.runQueryInSlave(query, params);
};

exports.createDataDictionaryField = async function(data) {
  const id = uuidv4();
  const query = `
    INSERT INTO sdui_data_dictionary 
    (id, resource_key, field_path, field_type, display_name, description, is_array_item, parent_path, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    id,
    data.resource_key,
    data.field_path,
    data.field_type,
    data.display_name,
    data.description || null,
    data.is_array_item ? 1 : 0,
    data.parent_path || null,
    data.sort_order || 0,
    data.is_active !== false ? 1 : 0
  ];

  await mysqlQueryRunner.runQueryInMaster(query, params);
  return id;
};

exports.updateDataDictionaryField = async function(id, data) {
  const updates = [];
  const params = [];

  const updateableFields = ['resource_key', 'field_path', 'field_type', 'display_name', 'description', 'is_array_item', 'parent_path', 'sort_order', 'is_active'];

  updateableFields.forEach(field => {
    if (data[field] !== undefined) {
      updates.push(`${field} = ?`);
      if (field === 'is_array_item' || field === 'is_active') {
        params.push(data[field] ? 1 : 0);
      } else {
        params.push(data[field]);
      }
    }
  });

  if (updates.length === 0) return false;

  const query = `UPDATE sdui_data_dictionary SET ${updates.join(', ')} WHERE id = ?`;
  params.push(id);

  const result = await mysqlQueryRunner.runQueryInMaster(query, params);
  return result.affectedRows > 0;
};

exports.deleteDataDictionaryField = async function(id) {
  const query = `UPDATE sdui_data_dictionary SET is_active = 0 WHERE id = ?`;
  const result = await mysqlQueryRunner.runQueryInMaster(query, [id]);
  return result.affectedRows > 0;
};

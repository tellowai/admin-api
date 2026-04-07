'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { v4: uuidv4 } = require('uuid');

exports.getPresentationRules = async function(resourceKey) {
  const query = `
    SELECT * FROM sdui_presentation_rules
    WHERE resource_key = ? AND is_active = 1
    ORDER BY sort_order ASC
  `;
  const result = await mysqlQueryRunner.runQueryInSlave(query, [resourceKey]);
  return result.map(row => ({
    ...row,
    conditions_json: row.conditions_json ? (typeof row.conditions_json === 'string' ? JSON.parse(row.conditions_json) : row.conditions_json) : []
  }));
};

exports.createPresentationRule = async function(data) {
  const id = uuidv4();
  const query = `
    INSERT INTO sdui_presentation_rules 
    (id, resource_key, rule_name, target_field, target_field_type, conditions_json, default_output, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    id,
    data.resource_key,
    data.rule_name,
    data.target_field,
    data.target_field_type,
    JSON.stringify(data.conditions_json || []),
    data.default_output || null,
    data.sort_order || 0,
    data.is_active !== false ? 1 : 0
  ];

  await mysqlQueryRunner.runQueryInMaster(query, params);
  return id;
};

exports.updatePresentationRule = async function(id, data) {
  const updates = [];
  const params = [];

  const updateableFields = ['rule_name', 'target_field', 'target_field_type', 'conditions_json', 'default_output', 'sort_order', 'is_active'];

  updateableFields.forEach(field => {
    if (data[field] !== undefined) {
      updates.push(`${field} = ?`);
      if (field === 'conditions_json') {
        params.push(JSON.stringify(data[field]));
      } else if (field === 'is_active') {
        params.push(data[field] ? 1 : 0);
      } else {
        params.push(data[field]);
      }
    }
  });

  if (updates.length === 0) return false;

  const query = `UPDATE sdui_presentation_rules SET ${updates.join(', ')} WHERE id = ?`;
  params.push(id);

  const result = await mysqlQueryRunner.runQueryInMaster(query, params);
  return result.affectedRows > 0;
};

exports.deletePresentationRule = async function(id) {
  const query = `UPDATE sdui_presentation_rules SET is_active = 0 WHERE id = ?`;
  const result = await mysqlQueryRunner.runQueryInMaster(query, [id]);
  return result.affectedRows > 0;
};

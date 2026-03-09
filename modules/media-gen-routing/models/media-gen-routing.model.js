'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.listCapabilities = async function () {
  const query = `SELECT * FROM media_gen_capabilities ORDER BY id ASC`;
  return mysqlQueryRunner.runQueryInSlave(query, []);
};

exports.listStyles = async function () {
  const query = `SELECT * FROM media_gen_styles ORDER BY id ASC`;
  return mysqlQueryRunner.runQueryInSlave(query, []);
};

exports.listRoutingRules = async function (filters = {}) {
  let query = `
    SELECT r.*, c.slug as capability_slug, c.name as capability_name,
           s.slug as style_slug, s.name as style_name,
           pm.name as primary_model_name, fm.name as fallback_model_name
    FROM media_gen_routing_rules r
    JOIN media_gen_capabilities c ON r.capability_id = c.id
    JOIN media_gen_styles s ON r.style_id = s.id
    LEFT JOIN ai_model_registry pm ON r.primary_amr_id = pm.amr_id
    LEFT JOIN ai_model_registry fm ON r.fallback_amr_id = fm.amr_id
    WHERE 1=1
  `;
  const params = [];
  if (filters.capability_id) {
    query += ' AND r.capability_id = ?';
    params.push(filters.capability_id);
  }
  if (filters.style_id) {
    query += ' AND r.style_id = ?';
    params.push(filters.style_id);
  }
  if (filters.user_tier) {
    query += ' AND r.user_tier = ?';
    params.push(filters.user_tier);
  }
  query += ' ORDER BY r.capability_id, r.style_id, r.user_tier';
  return mysqlQueryRunner.runQueryInSlave(query, params);
};

exports.createRoutingRule = async function (data) {
  const query = `
    INSERT INTO media_gen_routing_rules
    (capability_id, style_id, user_tier, primary_amr_id, fallback_amr_id, priority_weight, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    data.capability_id,
    data.style_id,
    data.user_tier || 'default',
    data.primary_amr_id,
    data.fallback_amr_id || null,
    data.priority_weight ?? 100,
    data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1
  ];
  const result = await mysqlQueryRunner.runQueryInMaster(query, params);
  return result.insertId;
};

exports.updateRoutingRule = async function (id, data) {
  const allowed = ['primary_amr_id', 'fallback_amr_id', 'priority_weight', 'is_active'];
  const updates = [];
  const params = [];
  allowed.forEach(k => {
    if (data[k] !== undefined) {
      if (k === 'is_active') {
        updates.push(`${k} = ?`);
        params.push(data[k] ? 1 : 0);
      } else {
        updates.push(`${k} = ?`);
        params.push(data[k]);
      }
    }
  });
  if (updates.length === 0) return 0;
  params.push(id);
  const query = `UPDATE media_gen_routing_rules SET ${updates.join(', ')} WHERE id = ?`;
  const result = await mysqlQueryRunner.runQueryInMaster(query, params);
  return result.affectedRows;
};

exports.deleteRoutingRule = async function (id) {
  const query = `DELETE FROM media_gen_routing_rules WHERE id = ?`;
  const result = await mysqlQueryRunner.runQueryInMaster(query, [id]);
  return result.affectedRows;
};

exports.getRoutingRuleById = async function (id) {
  const query = `
    SELECT r.*, c.slug as capability_slug, c.name as capability_name,
           s.slug as style_slug, s.name as style_name
    FROM media_gen_routing_rules r
    JOIN media_gen_capabilities c ON r.capability_id = c.id
    JOIN media_gen_styles s ON r.style_id = s.id
    WHERE r.id = ?
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [id]);
  return rows[0] || null;
};

'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.list = async function () {
  const q = `
    SELECT id, name, type, install_window_days, view_through_window_hours, is_default, created_at, updated_at
    FROM attribution_strategies
    ORDER BY is_default DESC, name ASC
  `;
  return mysqlQueryRunner.runQueryInSlave(q, []);
};

exports.getById = async function (id) {
  const q = `SELECT * FROM attribution_strategies WHERE id = ? LIMIT 1`;
  const rows = await mysqlQueryRunner.runQueryInSlave(q, [id]);
  return rows && rows[0] ? rows[0] : null;
};

exports.getDefault = async function () {
  const q = `
    SELECT * FROM attribution_strategies WHERE is_default = 1 LIMIT 1
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(q, []);
  return rows && rows[0] ? rows[0] : null;
};

exports.update = async function (id, patch) {
  const map = {
    name: 'name',
    type: 'type',
    install_window_days: 'install_window_days',
    view_through_window_hours: 'view_through_window_hours',
    is_default: 'is_default'
  };
  const fields = [];
  const vals = [];
  Object.keys(map).forEach((k) => {
    if (patch[k] !== undefined) {
      fields.push(`${map[k]} = ?`);
      vals.push(k === 'is_default' ? (patch[k] ? 1 : 0) : patch[k]);
    }
  });
  if (!fields.length) return;
  vals.push(id);
  const q = `UPDATE attribution_strategies SET ${fields.join(', ')} WHERE id = ?`;
  return mysqlQueryRunner.runQueryInMaster(q, vals);
};

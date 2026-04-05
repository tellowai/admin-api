'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.getPublished = async function () {
  const q = `SELECT * FROM sdui_app_theme WHERE status = 'published' ORDER BY version DESC LIMIT 1`;
  const rows = await mysqlQueryRunner.runQueryInSlave(q, []);
  return rows[0] || null;
};

exports.getLatestDraft = async function () {
  const q = `SELECT * FROM sdui_app_theme WHERE status = 'draft' ORDER BY id DESC LIMIT 1`;
  const rows = await mysqlQueryRunner.runQueryInSlave(q, []);
  return rows[0] || null;
};

exports.getAllVersions = async function () {
  const q = `SELECT id, version, status, notes, published_at, created_by, updated_by, created_at, updated_at
    FROM sdui_app_theme ORDER BY id DESC LIMIT 50`;
  return await mysqlQueryRunner.runQueryInSlave(q, []);
};

exports.getById = async function (id) {
  const q = `SELECT * FROM sdui_app_theme WHERE id = ?`;
  const rows = await mysqlQueryRunner.runQueryInSlave(q, [id]);
  return rows[0] || null;
};

exports.createDraft = async function ({ version, lightTokens, darkTokens, notes, createdBy }) {
  const q = `INSERT INTO sdui_app_theme (version, light_tokens, dark_tokens, status, notes, created_by, updated_by)
    VALUES (?, ?, ?, 'draft', ?, ?, ?)`;
  const res = await mysqlQueryRunner.runQueryInMaster(q, [
    version, lightTokens || null, darkTokens || null, notes || null, createdBy || null, createdBy || null,
  ]);
  return res.insertId;
};

exports.updateDraft = async function (id, { version, lightTokens, darkTokens, notes, updatedBy }) {
  const q = `UPDATE sdui_app_theme SET version = ?, light_tokens = ?, dark_tokens = ?, notes = ?, updated_by = ?
    WHERE id = ? AND status = 'draft'`;
  const res = await mysqlQueryRunner.runQueryInMaster(q, [
    version, lightTokens || null, darkTokens || null, notes || null, updatedBy || null, id,
  ]);
  return res.affectedRows;
};

exports.publish = async function (id, publishedBy) {
  await mysqlQueryRunner.runQueryInMaster(
    `UPDATE sdui_app_theme SET status = 'archived' WHERE status = 'published'`,
    [],
  );
  const q = `UPDATE sdui_app_theme SET status = 'published', published_at = NOW(), updated_by = ? WHERE id = ?`;
  const res = await mysqlQueryRunner.runQueryInMaster(q, [publishedBy || null, id]);
  return res.affectedRows;
};

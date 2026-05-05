'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.listAssets = async function (filters = {}) {
  const params = [];
  let where = '1=1';
  if (filters.script_key) {
    where += ' AND a.script_key = ?';
    params.push(filters.script_key);
  }
  if (filters.status) {
    where += ' AND a.status = ?';
    params.push(filters.status);
  }
  const q = `
    SELECT a.* FROM script_font_assets a
    WHERE ${where}
    ORDER BY a.script_key ASC, a.display_name ASC
  `;
  return mysqlQueryRunner.runQueryInSlave(q, params);
};

exports.getAssetById = async function (id, opts = {}) {
  const run = opts.useMaster ? mysqlQueryRunner.runQueryInMaster : mysqlQueryRunner.runQueryInSlave;
  const rows = await run('SELECT * FROM script_font_assets WHERE id = ? LIMIT 1', [id]);
  return rows && rows[0] ? rows[0] : null;
};

exports.insertAsset = async function (row) {
  const q = `
    INSERT INTO script_font_assets (id, display_name, css_family_name, script_key, file_sha256, status, status_note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  await mysqlQueryRunner.runQueryInMaster(q, [
    row.id,
    row.display_name,
    row.css_family_name,
    row.script_key,
    row.file_sha256 || null,
    row.status || 'disabled',
    row.status_note || null
  ]);
};

exports.updateAsset = async function (id, patch) {
  const allowed = ['display_name', 'css_family_name', 'script_key', 'file_sha256', 'status', 'status_note'];
  const sets = [];
  const params = [];
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      sets.push(`${k} = ?`);
      params.push(patch[k]);
    }
  }
  if (sets.length === 0) return;
  params.push(id);
  await mysqlQueryRunner.runQueryInMaster(
    `UPDATE script_font_assets SET ${sets.join(', ')} WHERE id = ?`,
    params
  );
};

exports.deleteAsset = async function (id) {
  await mysqlQueryRunner.runQueryInMaster('DELETE FROM script_font_assets WHERE id = ?', [id]);
};

exports.listSourcesByAssetId = async function (fontAssetId, opts = {}) {
  const run = opts.useMaster ? mysqlQueryRunner.runQueryInMaster : mysqlQueryRunner.runQueryInSlave;
  return run(
    'SELECT * FROM script_font_asset_sources WHERE font_asset_id = ? ORDER BY source_kind ASC, weight ASC',
    [fontAssetId]
  );
};

exports.insertSource = async function (row) {
  const q = `
    INSERT INTO script_font_asset_sources (id, font_asset_id, source_kind, weight, asset_bucket, asset_key)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  await mysqlQueryRunner.runQueryInMaster(q, [
    row.id,
    row.font_asset_id,
    row.source_kind,
    row.weight == null ? null : row.weight,
    row.asset_bucket,
    row.asset_key
  ]);
};

exports.updateSource = async function (id, patch) {
  const sets = [];
  const params = [];
  for (const k of ['source_kind', 'weight', 'asset_bucket', 'asset_key']) {
    if (patch[k] !== undefined) {
      sets.push(`${k} = ?`);
      params.push(patch[k]);
    }
  }
  if (sets.length === 0) return;
  params.push(id);
  await mysqlQueryRunner.runQueryInMaster(
    `UPDATE script_font_asset_sources SET ${sets.join(', ')} WHERE id = ?`,
    params
  );
};

exports.deleteSource = async function (id) {
  await mysqlQueryRunner.runQueryInMaster('DELETE FROM script_font_asset_sources WHERE id = ?', [id]);
};

exports.touchAssetUpdatedAt = async function (fontAssetId) {
  await mysqlQueryRunner.runQueryInMaster(
    'UPDATE script_font_assets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [fontAssetId]
  );
};

exports.listDefaults = async function () {
  return mysqlQueryRunner.runQueryInSlave(
    'SELECT script_key, font_asset_id, updated_at FROM script_font_defaults ORDER BY script_key ASC',
    []
  );
};

exports.upsertDefault = async function (scriptKey, fontAssetId) {
  await mysqlQueryRunner.runQueryInMaster(
    `INSERT INTO script_font_defaults (script_key, font_asset_id) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE font_asset_id = VALUES(font_asset_id), updated_at = CURRENT_TIMESTAMP`,
    [scriptKey, fontAssetId]
  );
};

exports.clearDefault = async function (scriptKey) {
  await mysqlQueryRunner.runQueryInMaster(
    `INSERT INTO script_font_defaults (script_key, font_asset_id) VALUES (?, NULL)
     ON DUPLICATE KEY UPDATE font_asset_id = NULL, updated_at = CURRENT_TIMESTAMP`,
    [scriptKey]
  );
};

exports.clearDefaultsReferencingAsset = async function (fontAssetId) {
  await mysqlQueryRunner.runQueryInMaster(
    'UPDATE script_font_defaults SET font_asset_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE font_asset_id = ?',
    [fontAssetId]
  );
};

exports.listOverridesByTemplateId = async function (templateId, opts = {}) {
  const run = opts.useMaster ? mysqlQueryRunner.runQueryInMaster : mysqlQueryRunner.runQueryInSlave;
  return run(
    'SELECT template_id, script_key, font_asset_id FROM template_script_font_overrides WHERE template_id = ?',
    [templateId]
  );
};

exports.replaceTemplateOverrides = async function (templateId, entries) {
  await mysqlQueryRunner.runQueryInMaster(
    'DELETE FROM template_script_font_overrides WHERE template_id = ?',
    [templateId]
  );
  const list = entries || [];
  if (list.length === 0) return;
  const placeholders = list.map(() => '(?, ?, ?)').join(', ');
  const params = [];
  for (const e of list) {
    params.push(templateId, e.script_key, e.font_asset_id);
  }
  await mysqlQueryRunner.runQueryInMaster(
    `INSERT INTO template_script_font_overrides (template_id, script_key, font_asset_id) VALUES ${placeholders}`,
    params
  );
};

exports.loadManifestPayloadFromDb = async function () {
  const assets = await mysqlQueryRunner.runQueryInSlave(
    `SELECT * FROM script_font_assets WHERE status = 'active' ORDER BY script_key, display_name`,
    []
  );
  const assetList = assets || [];
  const assetIds = assetList.map((a) => a.id);
  let allSources = [];
  if (assetIds.length > 0) {
    const inPh = assetIds.map(() => '?').join(', ');
    allSources = await mysqlQueryRunner.runQueryInSlave(
      `SELECT id, font_asset_id, source_kind, weight, asset_bucket, asset_key, updated_at
       FROM script_font_asset_sources
       WHERE font_asset_id IN (${inPh})
       ORDER BY font_asset_id, source_kind ASC, weight ASC`,
      assetIds
    );
  }
  const sourcesByAssetId = {};
  for (const s of allSources || []) {
    if (!sourcesByAssetId[s.font_asset_id]) sourcesByAssetId[s.font_asset_id] = [];
    sourcesByAssetId[s.font_asset_id].push({
      id: s.id,
      source_kind: s.source_kind,
      weight: s.weight,
      asset_bucket: s.asset_bucket,
      asset_key: s.asset_key,
      updated_at: s.updated_at
    });
  }
  const outAssets = assetList.map((a) => ({
    id: a.id,
    css_family_name: a.css_family_name,
    script_key: a.script_key,
    updated_at: a.updated_at,
    sources: sourcesByAssetId[a.id] || []
  }));
  const defaultsRows = await mysqlQueryRunner.runQueryInSlave(
    'SELECT script_key, font_asset_id FROM script_font_defaults',
    []
  );
  const defaultsByScriptKey = {};
  for (const d of defaultsRows || []) {
    defaultsByScriptKey[d.script_key] = d.font_asset_id;
  }
  const assetsById = {};
  for (const a of outAssets) {
    assetsById[a.id] = a;
  }
  return { assetsById, defaultsByScriptKey };
};

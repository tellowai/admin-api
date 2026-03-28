'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

function metadataToDb(val) {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  try {
    return JSON.stringify(val);
  } catch {
    return null;
  }
}

exports.list = async function (limit, offset, filters = {}) {
  const params = [];
  let q = `
    SELECT *
    FROM influencer_profiles
    WHERE 1=1
  `;
  if (filters.list_in_admin_only) {
    q += ` AND list_in_admin = 1`;
  }
  q += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return mysqlQueryRunner.runQueryInSlave(q, params);
};

exports.getById = async function (id) {
  const q = `SELECT * FROM influencer_profiles WHERE id = ? LIMIT 1`;
  const rows = await mysqlQueryRunner.runQueryInSlave(q, [id]);
  return rows && rows[0] ? rows[0] : null;
};

exports.getByExternalProfileKey = async function (key) {
  if (!key) return null;
  const q = `SELECT * FROM influencer_profiles WHERE external_profile_key = ? LIMIT 1`;
  const rows = await mysqlQueryRunner.runQueryInSlave(q, [String(key)]);
  return rows && rows[0] ? rows[0] : null;
};

function profileUrlsToDb(val) {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) return null;
  try {
    return JSON.stringify(val);
  } catch {
    return null;
  }
}

exports.insert = async function (row) {
  const q = `
    INSERT INTO influencer_profiles (
      id, name, handle, platform, profile_urls,
      is_active, list_in_admin,
      attribution_provider, external_profile_key, metadata, schema_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const listInAdmin =
    row.list_in_admin === undefined || row.list_in_admin === null ? 1 : row.list_in_admin ? 1 : 0;
  return mysqlQueryRunner.runQueryInMaster(q, [
    row.id,
    row.name,
    row.handle || null,
    row.platform || null,
    profileUrlsToDb(row.profile_urls),
    row.is_active !== false ? 1 : 0,
    listInAdmin,
    row.attribution_provider || 'internal',
    row.external_profile_key || null,
    metadataToDb(row.metadata),
    row.schema_version != null ? row.schema_version : 1
  ]);
};

exports.update = async function (id, patch) {
  const fields = [];
  const vals = [];
  const allowed = [
    'name',
    'handle',
    'platform',
    'is_active',
    'list_in_admin',
    'attribution_provider',
    'external_profile_key',
    'schema_version'
  ];
  allowed.forEach((k) => {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      if (k === 'is_active' || k === 'list_in_admin') vals.push(patch[k] ? 1 : 0);
      else vals.push(patch[k]);
    }
  });
  if (patch.profile_urls !== undefined) {
    fields.push('profile_urls = ?');
    vals.push(profileUrlsToDb(patch.profile_urls));
  }
  if (patch.metadata !== undefined) {
    fields.push('metadata = ?');
    vals.push(metadataToDb(patch.metadata));
  }
  if (!fields.length) return;
  vals.push(id);
  const q = `UPDATE influencer_profiles SET ${fields.join(', ')} WHERE id = ?`;
  return mysqlQueryRunner.runQueryInMaster(q, vals);
};

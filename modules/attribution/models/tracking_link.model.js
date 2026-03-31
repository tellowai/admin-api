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
    FROM tracking_links
    WHERE 1=1
  `;
  if (filters.influencer_profile_id) {
    q += ` AND influencer_profile_id = ?`;
    params.push(filters.influencer_profile_id);
  }
  if (filters.photo_booth_id) {
    q += ` AND photo_booth_id = ?`;
    params.push(filters.photo_booth_id);
  }
  q += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return mysqlQueryRunner.runQueryInSlave(q, params);
};

exports.listByInfluencerProfileId = async function (profileId) {
  const q = `
    SELECT *
    FROM tracking_links
    WHERE influencer_profile_id = ?
    ORDER BY created_at DESC
  `;
  return mysqlQueryRunner.runQueryInSlave(q, [profileId]);
};

exports.getById = async function (id) {
  const q = `SELECT * FROM tracking_links WHERE id = ? LIMIT 1`;
  const rows = await mysqlQueryRunner.runQueryInSlave(q, [id]);
  return rows && rows[0] ? rows[0] : null;
};

exports.getByShortCode = async function (shortCode) {
  const q = `SELECT * FROM tracking_links WHERE short_code = ? LIMIT 1`;
  const rows = await mysqlQueryRunner.runQueryInSlave(q, [shortCode]);
  return rows && rows[0] ? rows[0] : null;
};

exports.getLatestByPhotoBoothId = async function (photoBoothId) {
  if (!photoBoothId) return null;
  const q = `
    SELECT *
    FROM tracking_links
    WHERE photo_booth_id = ? AND is_active = 1
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(q, [photoBoothId]);
  return rows && rows[0] ? rows[0] : null;
};

exports.insert = async function (row) {
  const q = `
    INSERT INTO tracking_links (
      id, short_code, display_name, channel, platform, placement_platform, source_name, campaign, utm_medium, ad_group, ad_name,
      deep_link_path, redirect_url, tags, is_active, created_by,
      attribution_provider, external_link_key, metadata, schema_version, influencer_profile_id, photo_booth_id, sl_landing
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const tagsJson = row.tags != null ? JSON.stringify(row.tags) : null;
  const metadataJson = metadataToDb(row.metadata);
  const slLanding = row.sl_landing === 'website_only' ? 'website_only' : 'app_install';
  return mysqlQueryRunner.runQueryInMaster(q, [
    row.id,
    row.short_code,
    row.display_name || null,
    row.channel,
    row.platform || 'all',
    row.placement_platform || null,
    row.source_name || null,
    row.campaign || null,
    row.utm_medium || null,
    row.ad_group || null,
    row.ad_name || null,
    row.deep_link_path || null,
    row.redirect_url || null,
    tagsJson,
    row.is_active !== false ? 1 : 0,
    row.created_by || null,
    row.attribution_provider || 'internal',
    row.external_link_key || null,
    metadataJson,
    row.schema_version != null ? row.schema_version : 1,
    row.influencer_profile_id || null,
    row.photo_booth_id || null,
    slLanding
  ]);
};

exports.update = async function (id, patch) {
  const fields = [];
  const vals = [];
  const map = {
    short_code: 'short_code',
    display_name: 'display_name',
    channel: 'channel',
    platform: 'platform',
    placement_platform: 'placement_platform',
    source_name: 'source_name',
    campaign: 'campaign',
    utm_medium: 'utm_medium',
    ad_group: 'ad_group',
    ad_name: 'ad_name',
    deep_link_path: 'deep_link_path',
    redirect_url: 'redirect_url',
    is_active: 'is_active',
    attribution_provider: 'attribution_provider',
    external_link_key: 'external_link_key',
    schema_version: 'schema_version',
    influencer_profile_id: 'influencer_profile_id',
    photo_booth_id: 'photo_booth_id',
    sl_landing: 'sl_landing'
  };
  Object.keys(map).forEach((k) => {
    if (patch[k] !== undefined) {
      fields.push(`${map[k]} = ?`);
      if (k === 'is_active') vals.push(patch[k] ? 1 : 0);
      else vals.push(patch[k]);
    }
  });
  if (patch.tags !== undefined) {
    fields.push('tags = ?');
    vals.push(patch.tags != null ? JSON.stringify(patch.tags) : null);
  }
  if (patch.metadata !== undefined) {
    fields.push('metadata = ?');
    vals.push(metadataToDb(patch.metadata));
  }
  if (!fields.length) return;
  vals.push(id);
  const q = `UPDATE tracking_links SET ${fields.join(', ')} WHERE id = ?`;
  return mysqlQueryRunner.runQueryInMaster(q, vals);
};

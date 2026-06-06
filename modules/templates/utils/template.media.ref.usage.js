'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

const REF_LOOKUP_LIMIT = 50;

const TEMPLATE_ROW_KEY_COLUMNS = [
  'cf_r2_key',
  'thumb_frame_asset_key',
  'color_video_key',
  'mask_video_key',
  'transparent_webm_video_key',
  'bodymovin_json_key',
];

const TEMPLATE_JSON_KEY_COLUMNS = [
  'custom_text_input_fields',
  'image_input_fields_json',
  'image_uploads_json',
  'video_uploads_json',
  'additional_data',
];

function escapeLikePattern(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function uniqueIds(rows, field) {
  return [...new Set((rows || []).map((row) => row[field]).filter(Boolean))];
}

/** Active templates in ids, excluding one id. Returns true if any remain. */
async function hasActiveTemplateBesides(excludeTemplateId, candidateTemplateIds) {
  const ids = [...new Set((candidateTemplateIds || []).filter((id) => id && id !== excludeTemplateId))];
  if (!ids.length) return false;

  const rows = await mysqlQueryRunner.runQueryInSlave(
    `SELECT template_id FROM templates
     WHERE archived_at IS NULL AND template_id IN (?)
     LIMIT 1`,
    [ids]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function isKeyOnOtherTemplateRow(excludeTemplateId, key) {
  const rowMatchSql = TEMPLATE_ROW_KEY_COLUMNS.map((col) => `${col} = ?`).join(' OR ');
  const params = [excludeTemplateId, ...TEMPLATE_ROW_KEY_COLUMNS.map(() => key)];
  const rows = await mysqlQueryRunner.runQueryInSlave(
    `SELECT template_id FROM templates
     WHERE archived_at IS NULL AND template_id != ?
     AND (${rowMatchSql})
     LIMIT 1`,
    params
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function isKeyInOtherTemplateJson(excludeTemplateId, likePattern) {
  const jsonMatchSql = TEMPLATE_JSON_KEY_COLUMNS.map((col) => `${col} LIKE ? ESCAPE '\\\\'`).join(' OR ');
  const params = [excludeTemplateId, ...TEMPLATE_JSON_KEY_COLUMNS.map(() => likePattern)];
  const rows = await mysqlQueryRunner.runQueryInSlave(
    `SELECT template_id FROM templates
     WHERE archived_at IS NULL AND template_id != ?
     AND (${jsonMatchSql})
     LIMIT 1`,
    params
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function isKeyOnOtherTemplateLayer(excludeTemplateId, key, likePattern) {
  const layerRows = await mysqlQueryRunner.runQueryInSlave(
    `SELECT scene_id FROM template_layers
     WHERE asset_key = ? OR layer_config LIKE ? ESCAPE '\\\\'
     LIMIT ?`,
    [key, likePattern, REF_LOOKUP_LIMIT]
  );
  const sceneIds = uniqueIds(layerRows, 'scene_id');
  if (!sceneIds.length) return false;

  const sceneRows = await mysqlQueryRunner.runQueryInSlave(
    'SELECT template_id FROM template_scenes WHERE scene_id IN (?)',
    [sceneIds]
  );
  return hasActiveTemplateBesides(excludeTemplateId, uniqueIds(sceneRows, 'template_id'));
}

async function isKeyOnOtherTemplateWorkflowNode(excludeTemplateId, likePattern) {
  const nodeRows = await mysqlQueryRunner.runQueryInSlave(
    `SELECT wf_id FROM workflow_nodes
     WHERE config_values LIKE ? ESCAPE '\\\\'
     LIMIT ?`,
    [likePattern, REF_LOOKUP_LIMIT]
  );
  const wfIds = uniqueIds(nodeRows, 'wf_id');
  if (!wfIds.length) return false;

  const clipRows = await mysqlQueryRunner.runQueryInSlave(
    `SELECT template_id FROM template_ai_clips
     WHERE deleted_at IS NULL AND wf_id IN (?)`,
    [wfIds]
  );
  return hasActiveTemplateBesides(excludeTemplateId, uniqueIds(clipRows, 'template_id'));
}

async function isKeyOnOtherTemplateClipWorkflow(excludeTemplateId, likePattern) {
  const cwRows = await mysqlQueryRunner.runQueryInSlave(
    `SELECT tac_id FROM clip_workflow
     WHERE deleted_at IS NULL AND workflow LIKE ? ESCAPE '\\\\'
     LIMIT ?`,
    [likePattern, REF_LOOKUP_LIMIT]
  );
  const tacIds = uniqueIds(cwRows, 'tac_id');
  if (!tacIds.length) return false;

  const clipRows = await mysqlQueryRunner.runQueryInSlave(
    `SELECT template_id FROM template_ai_clips
     WHERE deleted_at IS NULL AND tac_id IN (?)`,
    [tacIds]
  );
  return hasActiveTemplateBesides(excludeTemplateId, uniqueIds(clipRows, 'template_id'));
}

/**
 * True when another non-archived template still references the same R2 object key.
 * Copy duplicates DB rows with the same keys — skip R2 delete when a sibling template still uses the key.
 *
 * Simple queries only (no joins); short-circuits on first match.
 *
 * @param {string} assetKey
 * @param {string} excludeTemplateId - template being updated
 * @returns {Promise<boolean>}
 */
async function isMediaAssetKeyUsedByOtherTemplates(assetKey, excludeTemplateId) {
  const key = assetKey != null ? String(assetKey).trim() : '';
  if (!key || !excludeTemplateId) return false;

  const likePattern = `%${escapeLikePattern(key)}%`;

  if (await isKeyOnOtherTemplateRow(excludeTemplateId, key)) return true;
  if (await isKeyOnOtherTemplateLayer(excludeTemplateId, key, likePattern)) return true;
  if (await isKeyInOtherTemplateJson(excludeTemplateId, likePattern)) return true;
  if (await isKeyOnOtherTemplateWorkflowNode(excludeTemplateId, likePattern)) return true;
  if (await isKeyOnOtherTemplateClipWorkflow(excludeTemplateId, likePattern)) return true;

  return false;
}

module.exports = {
  isMediaAssetKeyUsedByOtherTemplates,
};

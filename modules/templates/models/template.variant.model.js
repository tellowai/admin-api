'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { v7: uuidv7 } = require('uuid');

exports.getTemplateGroupMeta = async function (templateId, options = {}) {
  const query = `
    SELECT template_id, group_id, niche_id, variant_label, template_name
    FROM templates
    WHERE template_id = ?
    LIMIT 1
  `;
  const run = options.useMaster ? mysqlQueryRunner.runQueryInMaster : mysqlQueryRunner.runQueryInSlave;
  const [row] = await run(query, [templateId]);
  return row || null;
};

exports.listTemplatesByGroupId = async function (groupId, options = {}) {
  const query = `
    SELECT
      template_id,
      template_name,
      template_code,
      variant_label,
      niche_id,
      status,
      template_output_type,
      cf_r2_key,
      cf_r2_url,
      cf_r2_bucket,
      thumb_frame_asset_key,
      thumb_frame_bucket,
      created_at
    FROM templates
    WHERE group_id = ?
    AND archived_at IS NULL
    ORDER BY created_at ASC
  `;
  const run = options.useMaster ? mysqlQueryRunner.runQueryInMaster : mysqlQueryRunner.runQueryInSlave;
  return run(query, [groupId]);
};

exports.listTemplateIdsByGroupId = async function (groupId) {
  const query = `
    SELECT template_id
    FROM templates
    WHERE group_id = ?
    AND archived_at IS NULL
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [groupId]);
  return rows.map((r) => r.template_id);
};

exports.updateTemplateGroupId = async function (templateId, groupId) {
  const query = `
    UPDATE templates SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE template_id = ?
  `;
  return mysqlQueryRunner.runQueryInMaster(query, [groupId, templateId]);
};

exports.updateTemplateVariantLabel = async function (templateId, variantLabel) {
  const value = variantLabel == null || variantLabel === '' ? null : String(variantLabel).slice(0, 100);
  const query = `
    UPDATE templates SET variant_label = ?, updated_at = CURRENT_TIMESTAMP WHERE template_id = ?
  `;
  return mysqlQueryRunner.runQueryInMaster(query, [value, templateId]);
};

exports.clearTemplateGroupId = async function (templateId) {
  const query = `
    UPDATE templates SET group_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE template_id = ?
  `;
  return mysqlQueryRunner.runQueryInMaster(query, [templateId]);
};

exports.newGroupId = function newGroupId() {
  return uuidv7();
};

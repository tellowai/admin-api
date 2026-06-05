'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { slaveClickhouse } = require('../../../config/lib/clickhouse');

/**
 * Get all generation_node_executions for a media_generation_id. No joins.
 * @param {string} mediaGenerationId
 * @returns {Promise<Array<Object>>}
 */
exports.getByMediaGenerationId = async function (mediaGenerationId) {
  const query = `
    SELECT
      node_execution_id,
      media_generation_id,
      node_client_id,
      platform_ai_model_id,
      provider,
      execution_status,
      attempt_number,
      max_retries,
      input_payload,
      output_payload,
      execution_metrics,
      error_code,
      error_message,
      retry_history,
      created_at,
      started_at,
      completed_at,
      updated_at
    FROM generation_node_executions
    WHERE media_generation_id = ?
    ORDER BY created_at ASC, node_execution_id ASC
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [mediaGenerationId]);
  return rows || [];
};

/**
 * Get timeline context from media_generations for a given media_generation_id.
 * @param {string} mediaGenerationId
 * @returns {Promise<Object|null>} { created_at, started_at, completed_at, failed_at, template_id } or null
 */
exports.getMediaGenerationTimestamps = async function (mediaGenerationId) {
  const query = `
    SELECT created_at, started_at, completed_at, failed_at, template_id
    FROM media_generations
    WHERE media_generation_id = ?
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [mediaGenerationId]);
  return rows && rows[0] ? rows[0] : null;
};

/**
 * AI clip rows for a template (clip_index order). No joins.
 * @param {string} templateId
 * @returns {Promise<Array<{ clip_index: number, wf_id: number|null, asset_type: string|null }>>}
 */
exports.listTemplateAiClipsByTemplateId = async function (templateId) {
  if (!templateId) return [];
  const query = `
    SELECT clip_index, wf_id, asset_type
    FROM template_ai_clips
    WHERE template_id = ?
      AND deleted_at IS NULL
      AND asset_type IN ('image', 'video')
    ORDER BY clip_index ASC
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [templateId]);
  return rows || [];
};

/**
 * Template custom text / input field definitions for admin timeline labels.
 * @param {string} templateId
 * @returns {Promise<Array<Object>|null>}
 */
exports.getTemplateUserInputFields = async function (templateId) {
  if (!templateId) return null;
  const query = `
    SELECT custom_text_input_fields
    FROM templates
    WHERE template_id = ?
    LIMIT 1
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [templateId]);
  if (!rows || !rows[0]) return null;
  let fields = rows[0].custom_text_input_fields;
  if (fields == null) return null;
  if (typeof fields === 'string') {
    try {
      fields = JSON.parse(fields);
    } catch (_) {
      return null;
    }
  }
  return Array.isArray(fields) ? fields : null;
};

async function getGenerationAuditAdditionalData(mediaGenerationId) {
  const id = mediaGenerationId != null ? String(mediaGenerationId).trim() : '';
  if (!id) return null;

  const esc = (s) => String(s).replace(/'/g, "''");
  const query = `
    SELECT additional_data
    FROM resource_generations
    WHERE resource_generation_id = '${esc(id)}'
    LIMIT 1
  `;
  const result = await slaveClickhouse.querying(query, { dataObjects: true });
  const raw = result.data?.[0]?.additional_data;
  if (raw == null || raw === '') return null;

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  return typeof raw === 'object' ? raw : null;
}

/**
 * User-submitted custom_text_input_fields for one generation (from resource_generations audit blob).
 * @param {string} mediaGenerationId
 * @returns {Promise<Array<Object>>}
 */
exports.getGenerationCustomTextInputFields = async function (mediaGenerationId) {
  const data = await getGenerationAuditAdditionalData(mediaGenerationId);
  if (!data) return [];

  const fields = data.custom_text_input_fields;
  if (Array.isArray(fields)) return fields;
  if (fields && typeof fields === 'object') return Object.values(fields);
  return [];
};

/**
 * User-uploaded assets at generation time (from resource_generations.additional_data.uploaded_assets).
 * @param {string} mediaGenerationId
 * @returns {Promise<Array<Object>>}
 */
exports.getGenerationUploadedAssets = async function (mediaGenerationId) {
  const data = await getGenerationAuditAdditionalData(mediaGenerationId);
  if (!data) return [];

  const assets = data.uploaded_assets;
  return Array.isArray(assets) ? assets : [];
};

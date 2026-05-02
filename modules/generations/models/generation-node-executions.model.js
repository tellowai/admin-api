'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

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

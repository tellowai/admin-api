'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { v7: uuidv7 } = require('uuid');
const moment = require('moment');
const config = require('../../../config/config');
const WorkflowModel = require('../../workflow-builder/models/workflow.model');

const TEMPLATE_STATUS_ENUM = ['draft', 'review', 'active', 'inactive', 'suspended', 'archived'];

exports.listTemplates = async function (pagination) {
  const conditions = ['archived_at IS NULL'];
  const params = [];

  if (pagination.status && TEMPLATE_STATUS_ENUM.includes(pagination.status)) {
    conditions.push('status = ?');
    params.push(pagination.status);
  }

  params.push(pagination.limit, pagination.offset);

  const query = `
    SELECT 
      template_id,
      template_name,
      template_code,
      template_gender,
      template_output_type,
      template_clips_assets_type,
      template_type,
      cost_in_dollars,
      description,
      prompt,
      faces_needed,
      image_uploads_required,
      video_uploads_required,
      image_uploads_json,
      video_uploads_json,
      image_input_fields_json,
      niche_id,
      user_assets_layer,
      cf_r2_key,
      cf_r2_url,
      cf_r2_bucket,
      thumb_frame_asset_key,
      thumb_frame_bucket,
      color_video_bucket,
      color_video_key,
      mask_video_bucket,
      mask_video_key,
      bodymovin_json_bucket,
      bodymovin_json_key,
      custom_text_input_fields,
      credits,
      aspect_ratio,
      orientation,
      additional_data,
      status,
      created_at,
      updated_at
    FROM templates
    WHERE ${conditions.join(' AND ')}
    ORDER BY updated_at DESC, template_id DESC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, params);
};

exports.getTemplateGenerationMeta = async function (templateId) {
  const query = `
    SELECT 
      template_id,
      template_name,
      template_code,
      template_gender,
      aspect_ratio,
      orientation,
      template_output_type,
      template_clips_assets_type,
      credits,
      status
    FROM templates
    WHERE template_id = ?
    AND archived_at IS NULL
  `;

  const [template] = await mysqlQueryRunner.runQueryInSlave(query, [templateId]);
  return template;
};


exports.listArchivedTemplates = async function (pagination) {
  const query = `
    SELECT 
      template_id,
      template_name,
      template_code,
      template_gender,
      template_output_type,
      template_clips_assets_type,
      template_type,
      cost_in_dollars,
      description,
      prompt,
      faces_needed,
      image_uploads_required,
      video_uploads_required,
      image_uploads_json,
      video_uploads_json,
      image_input_fields_json,
      niche_id,
      user_assets_layer,
      cf_r2_key,
      cf_r2_url,
      cf_r2_bucket,
      thumb_frame_asset_key,
      thumb_frame_bucket,
      color_video_bucket,
      color_video_key,
      mask_video_bucket,
      mask_video_key,
      bodymovin_json_bucket,
      bodymovin_json_key,
      custom_text_input_fields,
      credits,
      aspect_ratio,
      orientation,
      additional_data,
      status,
      created_at,
      archived_at
    FROM templates
    WHERE archived_at IS NOT NULL
    ORDER BY archived_at DESC, template_id DESC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(
    query,
    [pagination.limit, pagination.offset]
  );
};

exports.getTemplatePrompt = async function (templateId) {
  const query = `
    SELECT 
      template_id,
      template_name,
      template_output_type,
      prompt,
      faces_needed,
      image_uploads_required,
      video_uploads_required,
      image_uploads_json,
      video_uploads_json,
      user_assets_layer,
      credits,
      aspect_ratio,
      orientation,
      additional_data,
      status
    FROM templates
    WHERE template_id = ?
    AND archived_at IS NULL
  `;

  const [template] = await mysqlQueryRunner.runQueryInSlave(query, [templateId]);
  return template;
};

exports.searchTemplates = async function (searchQuery, page, limit, status = null) {
  const offset = (page - 1) * limit;
  const conditions = [
    '(LOWER(template_name) LIKE LOWER(?) OR LOWER(template_code) LIKE LOWER(?) OR LOWER(prompt) LIKE LOWER(?))',
    'archived_at IS NULL'
  ];
  const params = [`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`];

  if (status && TEMPLATE_STATUS_ENUM.includes(status)) {
    conditions.push('status = ?');
    params.push(status);
  }

  params.push(limit, offset);

  const query = `
    SELECT 
      template_id,
      template_name,
      template_code,
      template_output_type,
      template_clips_assets_type,
      template_type,
      cost_in_dollars,
      description,
      faces_needed,
      image_uploads_required,
      video_uploads_required,
      image_uploads_json,
      video_uploads_json,
      user_assets_layer,
      cf_r2_key,
      cf_r2_url,
      cf_r2_bucket,
      thumb_frame_asset_key,
      thumb_frame_bucket,
      color_video_bucket,
      color_video_key,
      mask_video_bucket,
      mask_video_key,
      bodymovin_json_bucket,
      bodymovin_json_key,
      custom_text_input_fields,
      credits,
      aspect_ratio,
      orientation,
      additional_data,
      status,
      created_at
    FROM templates
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC, template_id DESC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, params);
};

exports.createTemplate = async function (templateData, clips = null) {
  // For templates with clips, use transaction to ensure data consistency
  const needsTransaction = clips && clips.length > 0;

  if (needsTransaction) {
    const connection = await mysqlQueryRunner.getConnectionFromMaster();

    try {
      await connection.beginTransaction();

      // Filter out undefined values and prepare fields and values
      const fields = [];
      const values = [];
      const placeholders = [];

      Object.entries(templateData).forEach(([key, value]) => {
        if (value !== undefined) {
          fields.push(key);
          values.push(value === null ? null :
            (key === 'faces_needed' || key === 'additional_data' || key === 'custom_text_input_fields' || key === 'image_uploads_json' || key === 'video_uploads_json' || key === 'image_input_fields_json') ?
              JSON.stringify(value) : value);
          placeholders.push('?');
        }
      });

      const insertQuery = `
        INSERT INTO templates (
          ${fields.join(', ')}
        ) VALUES (${placeholders.join(', ')})
      `;

      // Create template within transaction
      const result = await connection.query(insertQuery, values);

      // Create AI clips within the same transaction if they exist
      if (clips && clips.length > 0) {
        await this.createTemplateAiClipsInTransaction(connection, templateData.template_id, clips);
      }

      await connection.commit();
      return result;

    } catch (error) {
      console.error(error)
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } else {
    // For templates without clips, use regular insert
    const fields = [];
    const values = [];
    const placeholders = [];

    Object.entries(templateData).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(key);
        values.push(value === null ? null :
          (key === 'faces_needed' || key === 'additional_data' || key === 'custom_text_input_fields' || key === 'image_uploads_json' || key === 'video_uploads_json' || key === 'image_input_fields_json') ?
            JSON.stringify(value) : value);
        placeholders.push('?');
      }
    });

    const insertQuery = `
      INSERT INTO templates (
        ${fields.join(', ')}
      ) VALUES (${placeholders.join(', ')})
    `;

    const result = await mysqlQueryRunner.runQueryInMaster(insertQuery, values);
    return result;
  }
};

exports.updateTemplate = async function (templateId, templateData) {
  // Filter out undefined values and prepare set clause
  const setClause = [];
  const values = [];

  // Extract clips data and remove from template data (for regular updates)
  const clips = templateData.clips;
  delete templateData.clips;

  Object.entries(templateData).forEach(([key, value]) => {
    if (value !== undefined) {
      setClause.push(`${key} = ?`);
      values.push(value === null ? null :
        (key === 'faces_needed' || key === 'additional_data' || key === 'custom_text_input_fields' || key === 'image_uploads_json' || key === 'video_uploads_json' || key === 'image_input_fields_json') ?
          JSON.stringify(value) : value);
    }
  });

  // Add templateId to values array
  values.push(templateId);

  const query = `
    UPDATE templates 
    SET ${setClause.join(', ')}
    WHERE template_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, values);
  return result.affectedRows > 0;
};

/**
 * Update template with clips (transaction-aware version)
 */
exports.updateTemplateWithClips = async function (templateId, templateData, clips = null) {
  const connection = await mysqlQueryRunner.getConnectionFromMaster();

  try {
    await connection.beginTransaction();

    const setClause = [];
    const values = [];

    // Extract and remove clips data
    const clipsData = templateData.clips;
    delete templateData.clips;

    Object.entries(templateData).forEach(([key, value]) => {
      if (value !== undefined) {
        setClause.push(`${key} = ?`);
        values.push(value === null ? null :
          (key === 'faces_needed' || key === 'additional_data' || key === 'custom_text_input_fields' || key === 'image_uploads_json' || key === 'video_uploads_json' || key === 'image_input_fields_json') ?
            JSON.stringify(value) : value);
      }
    });

    // Update template within transaction if there are fields to update
    if (setClause.length > 0) {
      values.push(templateId);

      const updateQuery = `
    UPDATE templates
    SET ${setClause.join(', ')}
    WHERE template_id = ?
    AND archived_at IS NULL
  `;

      const result = await connection.query(updateQuery, values);

      if (result.affectedRows === 0) {
        await connection.rollback();
        return false;
      }
    }


    // Update AI clips within the same transaction
    if (clipsData && clipsData.length > 0) {
      // Delete existing clips for this template
      await this.deleteTemplateAiClipsInTransaction(connection, templateId);

      // Insert new clips
      await this.createTemplateAiClipsInTransaction(connection, templateId, clipsData);
    }

    await connection.commit();
    return true;

  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Get template by ID
 */
exports.getTemplateById = async function (templateId) {
  const query = `
    SELECT 
      template_id,
      template_name,
      template_code,
      template_gender,
      template_output_type,
      template_clips_assets_type,
      template_type,
      cost_in_dollars,
      description,
      prompt,
      faces_needed,
      image_uploads_required,
      video_uploads_required,
      image_uploads_json,
      video_uploads_json,
      image_input_fields_json,
      niche_id,
      user_assets_layer,
      cf_r2_key,
      cf_r2_url,
      cf_r2_bucket,
      thumb_frame_asset_key,
      thumb_frame_bucket,
      color_video_bucket,
      color_video_key,
      mask_video_bucket,
      mask_video_key,
      bodymovin_json_bucket,
      bodymovin_json_key,
      custom_text_input_fields,
      credits,
      aspect_ratio,
      orientation,
      additional_data,
      status,
      workflow_builder_version,
      created_at
    FROM templates
    WHERE template_id = ?
    AND archived_at IS NULL
  `;

  const [template] = await mysqlQueryRunner.runQueryInSlave(query, [templateId]);
  return template;
};

/**
 * Get template by code
 */
exports.getTemplateByCode = async function (templateCode) {
  const query = `
    SELECT 
      template_id,
      template_name,
      template_code,
      template_gender,
      template_output_type,
      template_clips_assets_type,
      template_type,
      cost_in_dollars,
      description,
      prompt,
      faces_needed,
      image_uploads_required,
      video_uploads_required,
      image_uploads_json,
      video_uploads_json,
      image_input_fields_json,
      niche_id,
      user_assets_layer,
      cf_r2_key,
      cf_r2_url,
      cf_r2_bucket,
      thumb_frame_asset_key,
      thumb_frame_bucket,
      color_video_bucket,
      color_video_key,
      mask_video_bucket,
      mask_video_key,
      bodymovin_json_bucket,
      bodymovin_json_key,
      custom_text_input_fields,
      credits,
      aspect_ratio,
      orientation,
      additional_data,
      status,
      created_at
    FROM templates
    WHERE template_code = ?
    AND archived_at IS NULL
  `;

  const [template] = await mysqlQueryRunner.runQueryInSlave(query, [templateCode]);
  return template;
};

/**
 * Get template by ID with complete data
 */
exports.getTemplateByIdWithAssets = async function (templateId) {
  const template = await this.getTemplateById(templateId);

  if (!template) {
    return null;
  }

  // Get AI clips for template
  template.clips = await this.getTemplateAiClips(templateId);

  return template;
};

/**
 * Get multiple templates by IDs with complete data for export
 */
exports.getTemplatesByIdsForExport = async function (templateIds) {
  if (!templateIds || templateIds.length === 0) {
    return [];
  }

  const placeholders = templateIds.map(() => '?').join(',');
  const query = `
    SELECT *
    FROM templates
    WHERE template_id IN (${placeholders})
    AND archived_at IS NULL
    ORDER BY created_at DESC
  `;

  const templates = await mysqlQueryRunner.runQueryInSlave(query, templateIds);

  const TemplateTagsModel = require('./template.tags.model');

  // Get AI clips and tags for each template
  for (const template of templates) {
    template.clips = await this.getTemplateAiClips(template.template_id);
    template.tags = await TemplateTagsModel.getTemplateTags(template.template_id);
  }

  return templates;
};

/**
 * Delete AI clips for a template (transaction-aware version)
 */
exports.deleteTemplateAiClipsInTransaction = async function (connection, templateId) {
  // First get all tac_ids for this template
  const getTacIdsQuery = `
    SELECT tac_id
    FROM template_ai_clips
    WHERE template_id = ?
    AND deleted_at IS NULL
  `;

  const tacIds = await connection.query(getTacIdsQuery, [templateId]);

  // Delete workflows for all clips
  if (tacIds.length > 0) {
    const tacIdList = tacIds.map(row => row.tac_id);
    const placeholders = tacIdList.map(() => '?').join(',');

    const softDeleteWorkflowsQuery = `
      UPDATE clip_workflow
      SET deleted_at = NOW()
      WHERE tac_id IN (${placeholders})
      AND deleted_at IS NULL
    `;

    await connection.query(softDeleteWorkflowsQuery, tacIdList);
  }

  // Then mark clips as deleted
  const deleteQuery = `
    UPDATE template_ai_clips
    SET deleted_at = NOW()
    WHERE template_id = ?
    AND deleted_at IS NULL
  `;

  await connection.query(deleteQuery, [templateId]);
};

/**
 * Delete AI clips for a template (non-transactional helper)
 */
exports.deleteTemplateAiClips = async function (templateId) {
  // First get all tac_ids for this template
  const getTacIdsQuery = `
    SELECT tac_id
    FROM template_ai_clips
    WHERE template_id = ?
    AND deleted_at IS NULL
  `;

  const tacRows = await mysqlQueryRunner.runQueryInMaster(getTacIdsQuery, [templateId]);

  // Delete workflows for all clips
  if (tacRows && tacRows.length > 0) {
    const tacIdList = tacRows.map(row => row.tac_id);
    const placeholders = tacIdList.map(() => '?').join(',');

    const softDeleteWorkflowsQuery = `
      UPDATE clip_workflow
      SET deleted_at = NOW()
      WHERE tac_id IN (${placeholders})
      AND deleted_at IS NULL
    `;

    await mysqlQueryRunner.runQueryInMaster(softDeleteWorkflowsQuery, tacIdList);
  }

  // Then mark clips as deleted
  const deleteQuery = `
    UPDATE template_ai_clips
    SET deleted_at = NOW()
    WHERE template_id = ?
    AND deleted_at IS NULL
  `;

  await mysqlQueryRunner.runQueryInMaster(deleteQuery, [templateId]);
};

exports.archiveTemplate = async function (templateId) {
  const query = `
    UPDATE templates 
    SET archived_at = NOW()
    WHERE template_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, [templateId]);
  return result.affectedRows > 0;
};

exports.bulkArchiveTemplates = async function (templateIds) {
  const placeholders = templateIds.map(() => '?').join(', ');
  const query = `
    UPDATE templates 
    SET archived_at = NOW()
    WHERE template_id IN (${placeholders})
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, templateIds);
  return result.affectedRows;
};

exports.bulkUnarchiveTemplates = async function (templateIds) {
  const placeholders = templateIds.map(() => '?').join(', ');
  const query = `
    UPDATE templates 
    SET archived_at = NULL
    WHERE template_id IN (${placeholders})
    AND archived_at IS NOT NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, templateIds);
  return result.affectedRows;
};

/**
 * Create AI clips for a template (transaction-aware version)
 */
exports.createTemplateAiClipsInTransaction = async function (connection, templateId, clips) {
  const clipData = [];

  for (const clip of clips) {
    const tacId = uuidv7();

    // Base clip data for new structure
    const baseClipData = {
      tac_id: tacId,
      template_id: templateId,
      clip_index: clip.clip_index,
      asset_type: clip.asset_type || 'video', // Default to video if not specified
      created_at: moment().format('YYYY-MM-DD HH:mm:ss'),
      updated_at: moment().format('YYYY-MM-DD HH:mm:ss')
    };

    clipData.push(baseClipData);
  }

  // Bulk insert clips within transaction
  if (clipData.length > 0) {
    const fields = Object.keys(clipData[0]);
    const placeholders = fields.map(() => '?').join(', ');
    const valuesPlaceholder = clipData.map(() => `(${placeholders})`).join(', ');

    const insertQuery = `
      INSERT INTO template_ai_clips (
        ${fields.join(', ')}
      ) VALUES ${valuesPlaceholder}
      `;

    const values = clipData.flatMap(clip => Object.values(clip));

    await connection.query(insertQuery, values);

    // Create workflow entries for each clip
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const tacId = clipData[i].tac_id;

      if (clip.workflow && clip.workflow.length > 0) {
        await this.createClipWorkflowInTransaction(connection, tacId, clip.workflow);
      }
    }
  }
};

/**
 * Create clip workflow entries (transaction-aware version)
 */
exports.createClipWorkflowInTransaction = async function (connection, tacId, workflow) {
  const workflowData = [];

  for (const step of workflow) {
    workflowData.push({
      tac_id: tacId,
      workflow: JSON.stringify(step),
      created_at: moment().format('YYYY-MM-DD HH:mm:ss'),
      updated_at: moment().format('YYYY-MM-DD HH:mm:ss')
    });
  }

  // Bulk insert workflow entries
  if (workflowData.length > 0) {
    const fields = Object.keys(workflowData[0]);
    const placeholders = fields.map(() => '?').join(', ');
    const valuesPlaceholder = workflowData.map(() => `(${placeholders})`).join(', ');

    const insertQuery = `
      INSERT INTO clip_workflow (
        ${fields.join(', ')}
      ) VALUES ${valuesPlaceholder}
    `;

    const values = workflowData.flatMap(workflow => Object.values(workflow));
    await connection.query(insertQuery, values);
  }
};

/**
 * Get or create a single template_ai_clip by (template_id, clip_index).
 * API accepts 0-based clip_index; DB stores 1-based (CHECK clip_index >= 1).
 * Returns { tac_id } for use when clip might not exist yet (e.g. workflow save before template save).
 * Simple queries, no joins.
 */
exports.ensureTemplateAiClip = async function (templateId, clipIndex, assetType = 'video') {
  const clipIndexDb = clipIndex + 1;
  const existingQuery = `
    SELECT tac_id FROM template_ai_clips
    WHERE template_id = ? AND clip_index = ? AND deleted_at IS NULL
  `;
  const existing = await mysqlQueryRunner.runQueryInSlave(existingQuery, [templateId, clipIndexDb]);
  if (existing.length > 0) return { tac_id: existing[0].tac_id };

  const tacId = uuidv7();
  const insertQuery = `
    INSERT INTO template_ai_clips (tac_id, template_id, clip_index, asset_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, NOW(), NOW())
  `;
  await mysqlQueryRunner.runQueryInMaster(insertQuery, [tacId, templateId, clipIndexDb, assetType]);
  return { tac_id: tacId };
};

/**
 * Ensure template_ai_clips rows exist for the given clip definitions, create a workflow per clip,
 * and attach wf_id in template_ai_clips. Returns the clips (same shape as getTemplateAiClips).
 * clips: array of { clip_index: number, asset_type: string }.
 */
exports.ensureTemplateAiClipsWithWorkflows = async function (templateId, clips, userId) {
  if (!clips || clips.length === 0) return [];
  for (const clip of clips) {
    const clipIndex = clip.clip_index;
    const assetType = clip.asset_type || 'video';
    const { tac_id } = await exports.ensureTemplateAiClip(templateId, clipIndex, assetType);
    await WorkflowModel.ensureWorkflowForTacId(tac_id, userId);
  }
  return await exports.getTemplateAiClips(templateId);
};

/**
 * Get clip summaries for a template (tac_id, clip_index, wf_id only). No joins, no legacy workflow.
 * Used for cross-clip source picker.
 */
exports.getTemplateClipSummaries = async function (templateId) {
  const query = `
    SELECT tac_id, clip_index, wf_id
    FROM template_ai_clips
    WHERE template_id = ? AND deleted_at IS NULL
    ORDER BY clip_index ASC
  `;
  return await mysqlQueryRunner.runQueryInSlave(query, [templateId]);
};

/**
 * Get AI clips for a template
 */
exports.getTemplateAiClips = async function (templateId) {
  const query = `
    SELECT 
      tac_id,
      template_id,
      clip_index,
      wf_id,
      asset_type,
      created_at,
      updated_at
    FROM template_ai_clips
    WHERE template_id = ?
    AND deleted_at IS NULL
    ORDER BY clip_index ASC
  `;

  const clips = await mysqlQueryRunner.runQueryInSlave(query, [templateId]);

  if (clips.length > 0) {
    clips.forEach(clip => {
      clip.workflow_id = clip.wf_id || null;
    });

    // Bulk fetch legacy workflows (clip_workflow) for all tac_ids in one query
    const tacIds = clips.map(c => c.tac_id);
    const workflowsByTac = await this.getClipWorkflowsByTacIds(tacIds);
    clips.forEach(clip => {
      clip.workflow = workflowsByTac.get(clip.tac_id) || [];
    });
  }

  return clips;
};

/**
 * Get legacy workflow arrays for multiple clips in one query (clip_workflow table).
 * @param {string[]} tacIds - template_ai_clips.tac_id values
 * @returns {Promise<Map<string, Array>>} Map of tac_id -> array of workflow step objects
 */
exports.getClipWorkflowsByTacIds = async function (tacIds) {
  if (!tacIds || tacIds.length === 0) return new Map();

  const unique = [...new Set(tacIds)].filter(Boolean);
  const query = `
    SELECT tac_id, workflow
    FROM clip_workflow
    WHERE tac_id IN (?)
    AND deleted_at IS NULL
    ORDER BY tac_id, cw_id ASC
  `;

  const rows = await mysqlQueryRunner.runQueryInSlave(query, [unique]);
  const byTac = new Map();

  for (const entry of rows) {
    let step = null;
    if (entry.workflow && typeof entry.workflow === 'string') {
      try {
        step = JSON.parse(entry.workflow);
      } catch (e) {
        step = null;
      }
    } else {
      step = entry.workflow;
    }
    if (step != null) {
      const list = byTac.get(entry.tac_id) || [];
      list.push(step);
      byTac.set(entry.tac_id, list);
    }
  }

  return byTac;
};

/**
 * Get workflow for a single clip (Legacy). Prefer getClipWorkflowsByTacIds for multiple clips.
 */
exports.getClipWorkflow = async function (tacId) {
  const byTac = await this.getClipWorkflowsByTacIds([tacId]);
  return byTac.get(tacId) || [];
};

/**
 * Create template tags for a template
 */
exports.createTemplateTags = async function (templateId, templateTagIds) {
  if (!templateTagIds || templateTagIds.length === 0) {
    return [];
  }

  // Extract both ttd_id and facet_id from templateTagIds

  const values = templateTagIds.map(() => `(?, ?, ?, NOW(), NOW())`).join(',');
  const query = `
    INSERT INTO template_tags (template_id, ttd_id, facet_id, created_at, updated_at)
    VALUES ${values}
  `;

  const queryParams = [];
  templateTagIds.forEach(tag => {
    queryParams.push(templateId, tag.ttd_id, tag.facet_id);
  });

  try {
    await mysqlQueryRunner.runQueryInMaster(query, queryParams);
    return await this.getTemplateTags(templateId);
  } catch (error) {
    throw error;
  }
};

/**
 * Get template tags for a template
 */
exports.getTemplateTags = async function (templateId) {
  const query = `
    SELECT 
      tt_id,
      template_id,
      ttd_id,
      facet_id,
      created_at,
      updated_at
    FROM template_tags
    WHERE template_id = ?
    AND deleted_at IS NULL
    ORDER BY created_at ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [templateId]);
};

/**
 * Update template tags (smart update - only add/remove what's needed)
 */
exports.updateTemplateTags = async function (templateId, templateTagIds) {
  // Get existing template tags
  const existingTags = await this.getTemplateTags(templateId);

  // Convert to comparable format for easier comparison (using both facet_id and ttd_id)
  const existingTagKeys = existingTags.map(tag => `${tag.facet_id}-${tag.ttd_id}`);
  const newTagKeys = (templateTagIds || []).map(tag => `${tag.facet_id}-${tag.ttd_id}`);

  // Find tags to remove (exist in current but not in new)
  const tagsToRemove = existingTags.filter(tag =>
    !newTagKeys.includes(`${tag.facet_id}-${tag.ttd_id}`)
  );

  // Find tags to add (exist in new but not in current)
  const tagsToAdd = (templateTagIds || []).filter(tag =>
    !existingTagKeys.includes(`${tag.facet_id}-${tag.ttd_id}`)
  );

  // Remove tags that are no longer needed
  if (tagsToRemove.length > 0) {
    const ttdIdsToRemove = tagsToRemove.map(tag => tag.ttd_id);
    await this.removeTemplateTags(templateId, ttdIdsToRemove);
  }

  // Add new tags (handle both new inserts and restoring soft-deleted tags)
  if (tagsToAdd.length > 0) {
    await this.createOrRestoreTemplateTags(templateId, tagsToAdd);
  }

  // Return updated tags
  return await this.getTemplateTags(templateId);
};

/**
 * Update template tags (legacy method - remove all existing and add new ones)
 */
exports.updateTemplateTagsLegacy = async function (templateId, templateTagIds) {
  // First remove all existing tags
  await this.removeAllTemplateTags(templateId);

  // Then add new tags if provided
  if (templateTagIds && templateTagIds.length > 0) {
    return await this.createTemplateTags(templateId, templateTagIds);
  }

  return [];
};

/**
 * Remove all template tags for a template
 */
exports.removeAllTemplateTags = async function (templateId) {
  const query = `
    UPDATE template_tags 
    SET deleted_at = NOW()
    WHERE template_id = ?
    AND deleted_at IS NULL
  `;

  await mysqlQueryRunner.runQueryInMaster(query, [templateId]);
  return true;
};

/**
 * Remove specific template tags for a template
 */
exports.removeTemplateTags = async function (templateId, ttdIds) {
  if (!ttdIds || ttdIds.length === 0) {
    return true;
  }

  const placeholders = ttdIds.map(() => '?').join(',');
  const query = `
    UPDATE template_tags 
    SET deleted_at = NOW()
    WHERE template_id = ? AND ttd_id IN (${placeholders})
    AND deleted_at IS NULL
  `;

  await mysqlQueryRunner.runQueryInMaster(query, [templateId, ...ttdIds]);
  return true;
};

/**
 * Check if a specific template tag exists
 */
exports.checkTemplateTagExists = async function (templateId, facetId, ttdId) {
  const query = `
    SELECT tt_id 
    FROM template_tags 
    WHERE template_id = ? AND facet_id = ? AND ttd_id = ?
    AND deleted_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInSlave(query, [templateId, facetId, ttdId]);
  return result.length > 0;
};

/**
 * Get AI clips for multiple templates (batch operation)
 */
exports.getTemplateAiClipsForMultipleTemplates = async function (templateIds) {
  if (!templateIds || templateIds.length === 0) {
    return [];
  }

  const placeholders = templateIds.map(() => '?').join(',');
  const query = `
    SELECT 
      tac_id,
      template_id,
      clip_index,
      wf_id,
      asset_type,
      created_at,
      updated_at
    FROM template_ai_clips
    WHERE template_id IN (${placeholders})
    AND deleted_at IS NULL
    ORDER BY template_id, clip_index ASC
  `;

  const clips = await mysqlQueryRunner.runQueryInSlave(query, templateIds);

  if (clips.length > 0) {
    clips.forEach(clip => {
      clip.workflow_id = clip.wf_id || null;
    });

    // 2. Fetch Legacy Workflows
    const tacIds = clips.map(clip => clip.tac_id);
    const workflowPlaceholders = tacIds.map(() => '?').join(',');
    const workflowQuery = `
      SELECT 
        cw_id,
        tac_id,
        workflow,
        created_at,
        updated_at
      FROM clip_workflow
      WHERE tac_id IN (${workflowPlaceholders})
      AND deleted_at IS NULL
    `;

    const workflows = await mysqlQueryRunner.runQueryInSlave(workflowQuery, tacIds);
    const workflowMap = new Map();

    // Group workflows by tac_id (multiple workflows per clip)
    workflows.forEach(workflow => {
      if (!workflowMap.has(workflow.tac_id)) {
        workflowMap.set(workflow.tac_id, []);
      }

      // Parse workflow JSON if it's a string
      let parsedWorkflow = workflow.workflow;
      if (typeof parsedWorkflow === 'string') {
        try {
          parsedWorkflow = JSON.parse(parsedWorkflow);
        } catch (error) {
          console.error('Error parsing workflow JSON:', error);
          parsedWorkflow = null;
        }
      }

      if (parsedWorkflow) {
        workflowMap.get(workflow.tac_id).push(parsedWorkflow);
      }
    });

    // Attach workflows to clips (as arrays)
    clips.forEach(clip => {
      clip.workflow = workflowMap.get(clip.tac_id) || [];
    });
  }

  return clips;
};

/**
 * Get template tags for multiple templates (batch operation)
 */
exports.getTemplateTagsForMultipleTemplates = async function (templateIds) {
  if (!templateIds || templateIds.length === 0) {
    return [];
  }

  const placeholders = templateIds.map(() => '?').join(',');
  const query = `
    SELECT 
      tt_id,
      template_id,
      ttd_id,
      facet_id,
      created_at,
      updated_at
    FROM template_tags
    WHERE template_id IN (${placeholders})
    AND deleted_at IS NULL
    ORDER BY template_id, created_at ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, templateIds);
};

/**
 * Create or restore template tags (handles both new inserts and soft-deleted restores)
 */
exports.createOrRestoreTemplateTags = async function (templateId, templateTagIds) {
  if (!templateTagIds || templateTagIds.length === 0) {
    return [];
  }

  // First, try to restore any soft-deleted tags
  const ttdIds = templateTagIds.map(tag => tag.ttd_id);
  const restoreQuery = `
    UPDATE template_tags 
    SET deleted_at = NULL, updated_at = NOW()
    WHERE template_id = ? AND ttd_id IN (${ttdIds.map(() => '?').join(',')})
    AND deleted_at IS NOT NULL
  `;

  await mysqlQueryRunner.runQueryInMaster(restoreQuery, [templateId, ...ttdIds]);

  // Then, insert any tags that don't exist at all (new or restored)
  const values = templateTagIds.map(() => `(?, ?, ?, NOW(), NOW())`).join(',');
  const insertQuery = `
    INSERT IGNORE INTO template_tags (template_id, ttd_id, facet_id, created_at, updated_at)
    VALUES ${values}
  `;

  const queryParams = [];
  templateTagIds.forEach(tag => {
    queryParams.push(templateId, tag.ttd_id, tag.facet_id);
  });

  try {
    await mysqlQueryRunner.runQueryInMaster(insertQuery, queryParams);
    return await this.getTemplateTags(templateId);
  } catch (error) {
    throw error;
  }
};

/**
 * Update template image input fields based on all clips' workflows.
 * Aggregates USER_INPUT_IMAGE / USER_INPUT_VIDEO nodes from all clips.
 */
exports.updateTemplateImageInputsFromClips = async function (templateId) {
  // 1. Get all clips for the template
  const clips = await this.getTemplateAiClips(templateId);
  if (!clips || clips.length === 0) return;

  const validWfIds = clips.map(c => c.wf_id).filter(id => id != null);
  if (validWfIds.length === 0) return;

  // 2. Fetch current template for existing fields
  const currentTemplate = await this.getTemplateById(templateId);
  let currentFields = [];
  try {
    if (currentTemplate && typeof currentTemplate.image_input_fields_json === 'string') {
      currentFields = JSON.parse(currentTemplate.image_input_fields_json);
    } else if (currentTemplate && Array.isArray(currentTemplate.image_input_fields_json)) {
      currentFields = currentTemplate.image_input_fields_json;
    }
  } catch (e) {
    console.error(`Error parsing image_input_fields_json for template ${templateId}:`, e);
  }

  // 3. Batch fetch nodes for all workflows
  const placeholders = validWfIds.map(() => '?').join(',');
  const nodesQuery = `
    SELECT wf_id, system_node_type, config_values, wfn_id
    FROM workflow_nodes
    WHERE wf_id IN (${placeholders})
    AND system_node_type IN ('USER_INPUT_IMAGE', 'USER_INPUT_VIDEO')
    ORDER BY wfn_id ASC 
  `;
  // Note: ORDER BY wfn_id assumption for determinism within a clip
  const nodes = await mysqlQueryRunner.runQueryInSlave(nodesQuery, validWfIds);

  // 4. Flatten nodes into an ordered list (Sorted by Clip Index -> Node Creation/ID)
  // This ensures inputs are listed sequentially: Clip 1 inputs, then Clip 2 inputs, etc.

  const wfIdToClipIndex = new Map(clips.map(c => [c.wf_id, c.clip_index]));

  // Sort nodes: First by Clip Index, then by Node ID (wfn_id)
  nodes.sort((a, b) => {
    const clipIndexA = wfIdToClipIndex.get(a.wf_id) || 0;
    const clipIndexB = wfIdToClipIndex.get(b.wf_id) || 0;
    // Primary sort: Clip Index
    if (clipIndexA !== clipIndexB) return clipIndexA - clipIndexB;
    // Secondary sort: Creation order (wfn_id) within the same clip
    return a.wfn_id - b.wfn_id;
  });

  const orderedNodes = nodes.map(node => ({
    clip_index: wfIdToClipIndex.get(node.wf_id),
    config: typeof node.config_values === 'string' ? JSON.parse(node.config_values) : node.config_values,
    system_type: node.system_node_type
  }));

  // 5. Logic for Cases:
  // Case 1: Equal count -> Do not change at all. (Return)
  // Case 2: Fewer nodes than fields -> Do not change at all. (Return)
  // Case 3: More nodes than fields -> Append new fields, copying structure from last one.

  const totalNodes = orderedNodes.length;
  const currentCount = currentFields.length;

  // Loop through all nodes to update existing fields (Case 1) or append new ones (Case 3)
  for (let i = 0; i < totalNodes; i++) {
    const nodeContext = orderedNodes[i];
    const isVideo = nodeContext.system_type === 'USER_INPUT_VIDEO';

    if (currentFields[i]) {
      // Existing field: Check for type mismatch
      const currentIsVideo = currentFields[i].field_data_type === 'video';

      if (isVideo !== currentIsVideo) {
        // Mismatch detected: Update type and related values
        currentFields[i].field_data_type = isVideo ? 'video' : 'photo';

        // Fix layer_name extension
        let layer = currentFields[i].layer_name || '';
        if (isVideo) {
          // Change .jpg/.png to .mp4, or default
          currentFields[i].layer_name = layer.replace(/\.(jpg|png|jpeg)$/i, '.mp4');
          if (!currentFields[i].layer_name.endsWith('.mp4')) currentFields[i].layer_name = `vid_${i}.mp4`;
        } else {
          // Change .mp4 to .jpg
          currentFields[i].layer_name = layer.replace(/\.mp4$/i, '.jpg');
          if (!currentFields[i].layer_name.endsWith('.jpg')) currentFields[i].layer_name = `img_${i}.jpg`;
        }

        // Set default label for type change if not provided by config
        if (!nodeContext.config?.label) {
          currentFields[i].label = isVideo ? 'Upload Video' : 'Upload Image';
        }
      }

      // Always update label and variable_name from node config (if present)
      if (nodeContext.config?.label) currentFields[i].label = nodeContext.config.label;
      if (nodeContext.config?.variable_name) currentFields[i].variable_name = nodeContext.config.variable_name;

      // Always sync clip_index
      currentFields[i].clip_index = nodeContext.clip_index;

    } else {
      // Expansion: New field needed
      let newField = {};
      if (currentFields.length > 0) {
        newField = JSON.parse(JSON.stringify(currentFields[currentFields.length - 1])); // Deep clone

        // User requested NOT to increment IDs/names. Keep them identical to the source.
        // BUT make field_code and user_input_field_name null explicitly.
        newField.field_code = null;
        newField.user_input_field_name = null;

        // Do not copy reference_image from the source template
        delete newField.reference_image;

        // Only update variable/label from node config
        if (nodeContext.config?.label) newField.label = nodeContext.config.label;
        if (nodeContext.config?.variable_name) newField.variable_name = nodeContext.config.variable_name;

        // Ensure type correctness for the new clone
        newField.field_data_type = isVideo ? 'video' : 'photo';
        // Fix layer name for clone
        let layer = newField.layer_name || '';
        if (isVideo) {
          newField.layer_name = layer.replace(/\.(jpg|png|jpeg)$/i, '.mp4');
          if (!newField.layer_name.endsWith('.mp4')) newField.layer_name = `vid_${i}.mp4`;
        } else {
          newField.layer_name = layer.replace(/\.mp4$/i, '.jpg');
          if (!newField.layer_name.endsWith('.jpg')) newField.layer_name = `img_${i}.jpg`;
        }

      } else {
        // Fallback if template started with 0 fields
        newField = {
          label: nodeContext.config?.label || (isVideo ? 'Upload Video' : 'Upload Image'),
          variable_name: nodeContext.config?.variable_name || `input_${i + 1}`,
          image_id: `image_${i}`,
          field_code: `image_${i}`,
          layer_name: isVideo ? `vid_${i}.mp4` : `img_${i}.jpg`,
          field_data_type: isVideo ? 'video' : 'photo',
          user_input_field_name: null
        };
      }

      newField.clip_index = nodeContext.clip_index;
      currentFields.push(newField);
    }
  }

  // 6. Update the template (Only for Case 3)
  const updateQuery = `
    UPDATE templates
    SET 
      image_uploads_required = ?,
      image_input_fields_json = ?
    WHERE template_id = ?
  `;
  await mysqlQueryRunner.runQueryInMaster(updateQuery, [totalNodes, JSON.stringify(currentFields), templateId]);
};

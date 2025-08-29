'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const config = require('../../../config/config');

exports.listTemplates = async function(pagination) {
  const query = `
    SELECT 
      template_id,
      template_name,
      template_code,
      template_gender,
      template_output_type,
      template_clips_assets_type,
      description,
      prompt,
      faces_needed,
      image_uploads_required,
      video_uploads_required,
      user_assets_layer,
      cf_r2_key,
      cf_r2_url,
      color_video_bucket,
      color_video_key,
      mask_video_bucket,
      mask_video_key,
      bodymovin_json_bucket,
      bodymovin_json_key,
      custom_text_input_fields,
      credits,
      additional_data,
      created_at
    FROM templates
    WHERE archived_at IS NULL
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(
    query, 
    [pagination.limit, pagination.offset]
  );
}; 

exports.getTemplatePrompt = async function(templateId) {
  const query = `
    SELECT 
      template_id,
      template_name,
      template_output_type,
      prompt,
      faces_needed,
      image_uploads_required,
      video_uploads_required,
      user_assets_layer,
      credits,
      additional_data
    FROM templates
    WHERE template_id = ?
    AND archived_at IS NULL
  `;

  const [template] = await mysqlQueryRunner.runQueryInSlave(query, [templateId]);
  return template;
}; 

exports.searchTemplates = async function(searchQuery, page, limit) {
  const offset = (page - 1) * limit;
  
  const query = `
    SELECT 
      template_id,
      template_name,
      template_code,
      template_output_type,
      template_clips_assets_type,
      description,
      faces_needed,
      image_uploads_required,
      video_uploads_required,
      user_assets_layer,
      cf_r2_key,
      cf_r2_url,
      color_video_bucket,
      color_video_key,
      mask_video_bucket,
      mask_video_key,
      bodymovin_json_bucket,
      bodymovin_json_key,
      custom_text_input_fields,
      credits,
      additional_data,
      created_at
    FROM templates
    WHERE LOWER(template_name) LIKE LOWER(?)
    OR LOWER(template_code) LIKE LOWER(?)
    OR LOWER(prompt) LIKE LOWER(?)
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  const searchPattern = `%${searchQuery}%`;
  return await mysqlQueryRunner.runQueryInSlave(
    query, 
    [searchPattern, searchPattern, searchPattern, limit, offset]
  );
}; 

exports.createTemplate = async function(templateData, clips = null) {
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
            (key === 'faces_needed' || key === 'additional_data' || key === 'custom_text_input_fields') ? 
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
          (key === 'faces_needed' || key === 'additional_data' || key === 'custom_text_input_fields') ? 
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

exports.updateTemplate = async function(templateId, templateData) {
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
        (key === 'faces_needed' || key === 'additional_data' || key === 'custom_text_input_fields') ? 
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
exports.updateTemplateWithClips = async function(templateId, templateData, clips = null) {
  const connection = await mysqlQueryRunner.getConnectionFromMaster();
  
  try {
    await connection.beginTransaction();

    // Filter out undefined values and prepare set clause
    const setClause = [];
    const values = [];

    // Extract clips data and remove from template data
    const clipsData = templateData.clips;
    delete templateData.clips;

    Object.entries(templateData).forEach(([key, value]) => {
      if (value !== undefined) {
        setClause.push(`${key} = ?`);
        values.push(value === null ? null : 
          (key === 'faces_needed' || key === 'additional_data' || key === 'custom_text_input_fields') ? 
          JSON.stringify(value) : value);
      }
    });

    // Update template within transaction if there are fields to update
    if (setClause.length > 0) {
      // Add templateId to values array
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
exports.getTemplateById = async function(templateId) {
  const query = `
    SELECT 
      template_id,
      template_name,
      template_code,
      template_gender,
      template_output_type,
      template_clips_assets_type,
      description,
      prompt,
      faces_needed,
      image_uploads_required,
      video_uploads_required,
      user_assets_layer,
      cf_r2_key,
      cf_r2_url,
      color_video_bucket,
      color_video_key,
      mask_video_bucket,
      mask_video_key,
      bodymovin_json_bucket,
      bodymovin_json_key,
      custom_text_input_fields,
      credits,
      additional_data,
      created_at
    FROM templates
    WHERE template_id = ?
    AND archived_at IS NULL
  `;

  const [template] = await mysqlQueryRunner.runQueryInSlave(query, [templateId]);
  return template;
};

/**
 * Get template by ID with complete data
 */
exports.getTemplateByIdWithAssets = async function(templateId) {
  const template = await this.getTemplateById(templateId);
  
  if (!template) {
    return null;
  }

  // Get AI clips for template
  template.clips = await this.getTemplateAiClips(templateId);

  return template;
};

/**
 * Delete AI clips for a template (transaction-aware version)
 */
exports.deleteTemplateAiClipsInTransaction = async function(connection, templateId) {
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
exports.deleteTemplateAiClips = async function(templateId) {
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

exports.archiveTemplate = async function(templateId) {
  const query = `
    UPDATE templates 
    SET archived_at = NOW()
    WHERE template_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, [templateId]);
  return result.affectedRows > 0;
};

exports.bulkArchiveTemplates = async function(templateIds) {
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

/**
 * Create AI clips for a template (transaction-aware version)
 */
exports.createTemplateAiClipsInTransaction = async function(connection, templateId, clips) {
  const clipData = [];
  
  for (const clip of clips) {
    const tacId = uuidv4();
    
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
exports.createClipWorkflowInTransaction = async function(connection, tacId, workflow) {
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
 * Get AI clips for a template
 */
exports.getTemplateAiClips = async function(templateId) {
  const query = `
    SELECT 
      tac_id,
      template_id,
      clip_index,
      asset_type,
      created_at,
      updated_at
    FROM template_ai_clips
    WHERE template_id = ?
    AND deleted_at IS NULL
    ORDER BY clip_index ASC
  `;

  const clips = await mysqlQueryRunner.runQueryInSlave(query, [templateId]);
  
  // Get workflow for each clip
  for (const clip of clips) {
    const workflow = await this.getClipWorkflow(clip.tac_id);
    clip.workflow = workflow;
  }
  
  return clips;
};

/**
 * Get workflow for a clip
 */
exports.getClipWorkflow = async function(tacId) {
  const query = `
    SELECT 
      cw_id,
      tac_id,
      workflow,
      created_at,
      updated_at
    FROM clip_workflow
    WHERE tac_id = ?
    AND deleted_at IS NULL
    ORDER BY cw_id ASC
  `;

  const workflowEntries = await mysqlQueryRunner.runQueryInSlave(query, [tacId]);
  
  // Parse workflow JSON and return as array
  return workflowEntries.map(entry => {
    if (entry.workflow && typeof entry.workflow === 'string') {
      try {
        return JSON.parse(entry.workflow);
      } catch (e) {
        return null;
      }
    }
    return entry.workflow;
  }).filter(Boolean);
}; 
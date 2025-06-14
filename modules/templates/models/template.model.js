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
      description,
      prompt,
      faces_needed,
      cf_r2_key,
      cf_r2_url,
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
      description,
      faces_needed,
      cf_r2_key,
      cf_r2_url,
      credits,
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

exports.createTemplate = async function(templateData) {
  // For video templates with clips, use transaction to ensure data consistency
  if (templateData.template_output_type === 'video' && templateData.clips && templateData.clips.length > 0) {
    const connection = await mysqlQueryRunner.getConnectionFromMaster();
    
    try {
      await connection.beginTransaction();

      // Filter out undefined values and prepare fields and values
      const fields = [];
      const values = [];
      const placeholders = [];

      // Extract clips data for video templates and remove from template data
      const clips = templateData.clips;
      delete templateData.clips;

      Object.entries(templateData).forEach(([key, value]) => {
        if (value !== undefined) {
          fields.push(key);
          values.push(value === null ? null : 
            (key === 'faces_needed' || key === 'additional_data') ? 
            JSON.stringify(value) : value);
          placeholders.push('?');
        }
      });

      const insertQuery = `
        INSERT INTO templates (
          ${fields.join(', ')}
        ) VALUES (${placeholders.join(', ')})
      `;
console.log(insertQuery,'insertQuery',values)
      // Create template within transaction
      const result = await connection.query(insertQuery, values);
      console.log(result,'result')
      // Create video clips within the same transaction
      await this.createTemplateVideoClipsInTransaction(connection, templateData.template_id, clips);
      
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
    // For non-video templates or video templates without clips, use regular insert
    const fields = [];
    const values = [];
    const placeholders = [];

    // Extract clips data for video templates and remove from template data
    const clips = templateData.clips;
    delete templateData.clips;

    Object.entries(templateData).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(key);
        values.push(value === null ? null : 
          (key === 'faces_needed' || key === 'additional_data') ? 
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
        (key === 'faces_needed' || key === 'additional_data') ? 
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
exports.updateTemplateWithClips = async function(templateId, templateData) {
  const connection = await mysqlQueryRunner.getConnectionFromMaster();
  
  try {
    await connection.beginTransaction();

    // Filter out undefined values and prepare set clause
    const setClause = [];
    const values = [];

    // Extract clips data for video templates and remove from template data
    const clips = templateData.clips;
    delete templateData.clips;

    Object.entries(templateData).forEach(([key, value]) => {
      if (value !== undefined) {
        setClause.push(`${key} = ?`);
        values.push(value === null ? null : 
          (key === 'faces_needed' || key === 'additional_data') ? 
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

    // Update video clips within the same transaction
    if (clips && clips.length > 0) {
      // Delete existing clips for this template
      await this.deleteTemplateVideoClipsInTransaction(connection, templateId);
      
      // Insert new clips
      await this.createTemplateVideoClipsInTransaction(connection, templateId, clips);
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
      description,
      prompt,
      faces_needed,
      cf_r2_key,
      cf_r2_url,
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
 * Delete video clips for a template (transaction-aware version)
 */
exports.deleteTemplateVideoClipsInTransaction = async function(connection, templateId) {
  const deleteQuery = `
    UPDATE template_video_clips
    SET deleted_at = NOW()
    WHERE template_id = ?
    AND deleted_at IS NULL
  `;

  await connection.query(deleteQuery, [templateId]);
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

/**
 * Create video clips for a template (transaction-aware version)
 */
exports.createTemplateVideoClipsInTransaction = async function(connection, templateId, clips) {
  const clipData = [];
  
  for (const clip of clips) {
    const tvcId = uuidv4();
    
    // Base clip data
    const baseClipData = {
      tvc_id: tvcId,
      template_id: templateId,
      clip_index: clip.clip_index,
      video_type: clip.video_type,
      created_at: moment(clip.created_at).format('YYYY-MM-DD HH:mm:ss.SSS'),
      updated_at: moment(clip.updated_at).format('YYYY-MM-DD HH:mm:ss.SSS')
    };

    // Add type-specific fields
    if (clip.video_type === 'ai') {
      Object.assign(baseClipData, {
        video_prompt: clip.video_prompt || null,
        video_ai_model: clip.video_ai_model || null,
        video_quality: clip.video_quality || null,
        characters: clip.characters ? JSON.stringify(clip.characters) : null,
        reference_image_type: 'ai', // Default as per schema
        reference_image_ai_model: null, // Can be set if needed
        template_image_asset_key: clip.template_image_asset_key || null,
        template_image_asset_bucket: config.os2.r2.public.bucket,
        video_file_asset_key: null,
        video_file_asset_bucket: null,
        requires_user_input: null,
        custom_input_fields: null
      });
    } else if (clip.video_type === 'static') {
      Object.assign(baseClipData, {
        video_prompt: null,
        video_ai_model: null,
        video_quality: null,
        characters: null,
        reference_image_type: 'ai', // Default as per schema
        reference_image_ai_model: null,
        template_image_asset_key: null,
        template_image_asset_bucket: config.os2.r2.public.bucket,
        video_file_asset_key: clip.video_file_asset_key || null,
        video_file_asset_bucket: null, // Can be set if needed
        requires_user_input: clip.requires_user_input || null,
        custom_input_fields: clip.custom_input_fields ? JSON.stringify(clip.custom_input_fields) : null
      });
    }

    clipData.push(baseClipData);
  }

  // Bulk insert clips within transaction
  if (clipData.length > 0) {
    const fields = Object.keys(clipData[0]);
    const placeholders = fields.map(() => '?').join(', ');
    const valuesPlaceholder = clipData.map(() => `(${placeholders})`).join(', ');
    
    const insertQuery = `
      INSERT INTO template_video_clips (
        ${fields.join(', ')}
      ) VALUES ${valuesPlaceholder}
      `;
    
    const values = clipData.flatMap(clip => Object.values(clip));
      
    console.log(insertQuery,'insertQuery2', values)
    await connection.query(insertQuery, values);
  }
};

/**
 * Create video clips for a template (standalone version - kept for compatibility)
 */
exports.createTemplateVideoClips = async function(templateId, clips) {
  const clipData = [];
  
  for (const clip of clips) {
    const tvcId = uuidv4();
    
    // Base clip data
    const baseClipData = {
      tvc_id: tvcId,
      template_id: templateId,
      clip_index: clip.clip_index,
      video_type: clip.video_type,
      created_at: moment(clip.created_at).format('YYYY-MM-DD HH:mm:ss.SSS'),
      updated_at: moment(clip.updated_at).format('YYYY-MM-DD HH:mm:ss.SSS')
    };

    // Add type-specific fields
    if (clip.video_type === 'ai') {
      Object.assign(baseClipData, {
        video_prompt: clip.video_prompt || null,
        video_ai_model: clip.video_ai_model || null,
        video_quality: clip.video_quality || null,
        characters: clip.characters ? JSON.stringify(clip.characters) : null,
        reference_image_type: 'ai', // Default as per schema
        reference_image_ai_model: null, // Can be set if needed
        template_image_asset_key: clip.template_image_asset_key || null,
        template_image_asset_bucket: null, // Can be set if needed
        video_file_asset_key: null,
        video_file_asset_bucket: null,
        requires_user_input: null,
        custom_input_fields: null
      });
    } else if (clip.video_type === 'static') {
      Object.assign(baseClipData, {
        video_prompt: null,
        video_ai_model: null,
        video_quality: null,
        characters: null,
        reference_image_type: 'ai', // Default as per schema
        reference_image_ai_model: null,
        template_image_asset_key: null,
        template_image_asset_bucket: null,
        video_file_asset_key: clip.video_file_asset_key || null,
        video_file_asset_bucket: null, // Can be set if needed
        requires_user_input: clip.requires_user_input || null,
        custom_input_fields: clip.custom_input_fields ? JSON.stringify(clip.custom_input_fields) : null
      });
    }

    clipData.push(baseClipData);
  }

  // Bulk insert clips
  if (clipData.length > 0) {
    const fields = Object.keys(clipData[0]);
    const placeholders = fields.map(() => '?').join(', ');
    const valuesPlaceholder = clipData.map(() => `(${placeholders})`).join(', ');
    
    const insertQuery = `
      INSERT INTO template_video_clips (
        ${fields.join(', ')}
      ) VALUES ${valuesPlaceholder}
    `;

    const values = clipData.flatMap(clip => Object.values(clip));
    
    await mysqlQueryRunner.runQueryInMaster(insertQuery, values);
  }
};

/**
 * Get video clips for a template
 */
exports.getTemplateVideoClips = async function(templateId) {
  const query = `
    SELECT 
      tvc_id,
      template_id,
      clip_index,
      video_type,
      video_prompt,
      video_ai_model,
      video_quality,
      characters,
      reference_image_type,
      reference_image_ai_model,
      template_image_asset_key,
      template_image_asset_bucket,
      video_file_asset_key,
      video_file_asset_bucket,
      requires_user_input,
      custom_input_fields,
      created_at,
      updated_at
    FROM template_video_clips
    WHERE template_id = ?
    AND deleted_at IS NULL
    ORDER BY clip_index ASC
  `;

  const clips = await mysqlQueryRunner.runQueryInSlave(query, [templateId]);
  
  // Parse JSON fields
  return clips.map(clip => {
    if (clip.characters && typeof clip.characters === 'string') {
      try {
        clip.characters = JSON.parse(clip.characters);
      } catch (e) {
        clip.characters = null;
      }
    }
    
    if (clip.custom_input_fields && typeof clip.custom_input_fields === 'string') {
      try {
        clip.custom_input_fields = JSON.parse(clip.custom_input_fields);
      } catch (e) {
        clip.custom_input_fields = null;
      }
    }
    
    return clip;
  });
}; 
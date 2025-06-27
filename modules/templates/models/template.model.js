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
      sounds,
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
      sounds,
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

exports.createTemplate = async function(templateData, aeAssetData = null) {
  // For video templates with clips or AE assets, use transaction to ensure data consistency
  const needsTransaction = (templateData.template_output_type === 'video' && templateData.clips && templateData.clips.length > 0) || aeAssetData;
  
  if (needsTransaction) {
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
            (key === 'faces_needed' || key === 'additional_data' || key === 'sounds') ? 
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

      // Create video clips within the same transaction if they exist
      if (clips && clips.length > 0) {
        await this.createTemplateVideoClipsInTransaction(connection, templateData.template_id, clips);
      }

      // Create AE assets within the same transaction if they exist
      if (aeAssetData) {
        await this.createTemplateAeAssetsInTransaction(connection, aeAssetData);
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
          (key === 'faces_needed' || key === 'additional_data' || key === 'sounds') ? 
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
        (key === 'faces_needed' || key === 'additional_data' || key === 'sounds') ? 
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
exports.updateTemplateWithClips = async function(templateId, templateData, aeAssetData = null) {
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
          (key === 'faces_needed' || key === 'additional_data' || key === 'sounds') ? 
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

    // Update AE assets within the same transaction
    if (aeAssetData) {
      // Delete existing AE assets for this template
      await this.deleteTemplateAeAssetsInTransaction(connection, templateId);
      
      // Insert new AE assets
      await this.createTemplateAeAssetsInTransaction(connection, aeAssetData);
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
      sounds,
      created_at
    FROM templates
    WHERE template_id = ?
    AND archived_at IS NULL
  `;

  const [template] = await mysqlQueryRunner.runQueryInSlave(query, [templateId]);
  return template;
};

/**
 * Get template by ID with AE assets (complete template data)
 */
exports.getTemplateByIdWithAssets = async function(templateId) {
  const template = await this.getTemplateById(templateId);
  
  if (!template) {
    return null;
  }

  // Get AE assets for video templates
  if (template.template_output_type === 'video') {
    const aeAssets = await this.getTemplateAeAssets(templateId);
    if (aeAssets) {
      template.ae_assets = aeAssets;
    }

    // Get video clips for video templates
    template.clips = await this.getTemplateVideoClips(templateId);
  }

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

/**
 * Delete AE assets for a template (transaction-aware version)
 */
exports.deleteTemplateAeAssetsInTransaction = async function(connection, templateId) {
  const deleteQuery = `
    UPDATE template_ae_assets
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
      const templateImageAssetKey = clip.template_image_asset_key || null;
      Object.assign(baseClipData, {
        asset_prompt: clip.asset_prompt || null,
        asset_ai_model: clip.asset_ai_model || null,
        asset_quality: clip.asset_quality || null,
        characters: clip.characters ? JSON.stringify(clip.characters) : null,
        asset_type: clip.asset_type || 'video',
        generation_type: clip.generation_type || 'generate',
        reference_image_type: clip.reference_image_type || (templateImageAssetKey ? 'ai' : 'none'),
        reference_image_ai_model: clip.reference_image_ai_model || null,
        template_image_asset_key: templateImageAssetKey,
        template_image_asset_bucket: clip.template_image_asset_bucket || (templateImageAssetKey ? config.os2.r2.public.bucket : null),
        video_file_asset_key: null,
        video_file_asset_bucket: null,
        requires_user_input: null,
        custom_input_fields: null
      });
    } else if (clip.video_type === 'static') {
      const templateImageAssetKey = clip.template_image_asset_key || null;
      Object.assign(baseClipData, {
        asset_prompt: null,
        asset_ai_model: null,
        asset_quality: null,
        characters: null,
        asset_type: clip.asset_type || 'video',
        generation_type: clip.generation_type || 'generate',
        reference_image_type: clip.reference_image_type || (templateImageAssetKey ? 'ai' : 'none'),
        reference_image_ai_model: clip.reference_image_ai_model || null,
        template_image_asset_key: templateImageAssetKey,
        template_image_asset_bucket: clip.template_image_asset_bucket || (templateImageAssetKey ? config.os2.r2.public.bucket : null),
        video_file_asset_key: clip.video_file_asset_key || null,
        video_file_asset_bucket: clip.video_file_asset_bucket || (clip.video_file_asset_key ? config.os2.r2.public.bucket : null),
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

    await connection.query(insertQuery, values);
  }
};

/**
 * Create AE assets for a template (transaction-aware version)
 */
exports.createTemplateAeAssetsInTransaction = async function(connection, aeAssetData) {
  // Filter out undefined values and prepare fields and values
  const fields = [];
  const values = [];
  const placeholders = [];

  Object.entries(aeAssetData).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(key);
      values.push(value);
      placeholders.push('?');
    }
  });

  if (fields.length > 0) {
    const insertQuery = `
      INSERT INTO template_ae_assets (
        ${fields.join(', ')}
      ) VALUES (${placeholders.join(', ')})
    `;

    await connection.query(insertQuery, values);
  }
};

/**
 * Get AE assets for a template
 */
exports.getTemplateAeAssets = async function(templateId) {
  const query = `
    SELECT 
      taae_id,
      template_id,
      color_video_bucket,
      color_video_key,
      mask_video_bucket,
      mask_video_key,
      bodymovin_json_bucket,
      bodymovin_json_key,
      created_at,
      updated_at
    FROM template_ae_assets
    WHERE template_id = ?
    AND deleted_at IS NULL
  `;

  const [aeAssets] = await mysqlQueryRunner.runQueryInSlave(query, [templateId]);
  return aeAssets;
};

/**
 * Get AE assets for multiple templates (batch fetch)
 */
exports.getTemplateAeAssetsBatch = async function(templateIds) {
  if (!templateIds || templateIds.length === 0) {
    return [];
  }

  const placeholders = templateIds.map(() => '?').join(',');
  const query = `
    SELECT 
      taae_id,
      template_id,
      color_video_bucket,
      color_video_key,
      mask_video_bucket,
      mask_video_key,
      bodymovin_json_bucket,
      bodymovin_json_key,
      created_at,
      updated_at
    FROM template_ae_assets
    WHERE template_id IN (${placeholders})
    AND deleted_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, templateIds);
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
      const templateImageAssetKey = clip.template_image_asset_key || null;
      Object.assign(baseClipData, {
        asset_prompt: clip.asset_prompt || null,
        asset_ai_model: clip.asset_ai_model || null,
        asset_quality: clip.asset_quality || null,
        characters: clip.characters ? JSON.stringify(clip.characters) : null,
        asset_type: clip.asset_type || 'video',
        generation_type: clip.generation_type || 'generate',
        reference_image_type: clip.reference_image_type || (templateImageAssetKey ? 'ai' : 'none'),
        reference_image_ai_model: clip.reference_image_ai_model || null,
        template_image_asset_key: templateImageAssetKey,
        template_image_asset_bucket: clip.template_image_asset_bucket || (templateImageAssetKey ? config.os2.r2.public.bucket : null),
        video_file_asset_key: null,
        video_file_asset_bucket: null,
        requires_user_input: null,
        custom_input_fields: null
      });
    } else if (clip.video_type === 'static') {
      const templateImageAssetKey = clip.template_image_asset_key || null;
      Object.assign(baseClipData, {
        asset_prompt: null,
        asset_ai_model: null,
        asset_quality: null,
        characters: null,
        asset_type: clip.asset_type || 'video',
        generation_type: clip.generation_type || 'generate',
        reference_image_type: clip.reference_image_type || (templateImageAssetKey ? 'ai' : 'none'),
        reference_image_ai_model: clip.reference_image_ai_model || null,
        template_image_asset_key: templateImageAssetKey,
        template_image_asset_bucket: clip.template_image_asset_bucket || (templateImageAssetKey ? config.os2.r2.public.bucket : null),
        video_file_asset_key: clip.video_file_asset_key || null,
        video_file_asset_bucket: clip.video_file_asset_bucket || (clip.video_file_asset_key ? config.os2.r2.public.bucket : null),
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
      asset_prompt,
      asset_ai_model,
      asset_quality,
      characters,
      asset_type,
      generation_type,
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
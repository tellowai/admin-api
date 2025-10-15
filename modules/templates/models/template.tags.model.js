'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.getTemplateTags = async function(templateId) {
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

exports.assignTagsToTemplate = async function(templateId, tagDefinitionIds) {
  if (!tagDefinitionIds || tagDefinitionIds.length === 0) {
    return [];
  }

  // First, remove existing tags for this template
  await this.removeAllTagsFromTemplate(templateId);

  // Fetch facet_id for each ttd_id from template_tag_definitions
  const placeholders = tagDefinitionIds.map(() => '?').join(',');
  const fetchFacetQuery = `
    SELECT ttd_id, facet_id
    FROM template_tag_definitions
    WHERE ttd_id IN (${placeholders})
    AND archived_at IS NULL
  `;

  const tagDefinitions = await mysqlQueryRunner.runQueryInSlave(fetchFacetQuery, tagDefinitionIds);

  // Create a map of ttd_id to facet_id
  const ttdToFacetMap = {};
  tagDefinitions.forEach(def => {
    ttdToFacetMap[def.ttd_id] = def.facet_id;
  });

  // Insert new tag assignments with facet_id
  const values = tagDefinitionIds.map(() => `(?, ?, ?, NOW(), NOW())`).join(',');
  const query = `
    INSERT INTO template_tags (template_id, ttd_id, facet_id, created_at, updated_at)
    VALUES ${values}
  `;

  const queryParams = [];
  tagDefinitionIds.forEach(ttdId => {
    queryParams.push(templateId, ttdId, ttdToFacetMap[ttdId]);
  });

  await mysqlQueryRunner.runQueryInMaster(query, queryParams);

  // Return the assigned tags
  return await this.getTemplateTags(templateId);
};

exports.importTagsToTemplate = async function(templateId, tags) {
  if (!tags || tags.length === 0) {
    return [];
  }

  // First, remove existing tags for this template
  await this.removeAllTagsFromTemplate(templateId);

  // Insert new tag assignments with both ttd_id and facet_id
  const values = tags.map(() => `(?, ?, ?, NOW(), NOW())`).join(',');
  const query = `
    INSERT INTO template_tags (template_id, ttd_id, facet_id, created_at, updated_at)
    VALUES ${values}
  `;

  const queryParams = [];
  tags.forEach(tag => {
    queryParams.push(templateId, tag.ttd_id, tag.facet_id);
  });

  await mysqlQueryRunner.runQueryInMaster(query, queryParams);

  // Return the assigned tags
  return await this.getTemplateTags(templateId);
};

exports.removeAllTagsFromTemplate = async function(templateId) {
  const query = `
    UPDATE template_tags 
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE template_id = ?
    AND deleted_at IS NULL
  `;

  await mysqlQueryRunner.runQueryInMaster(query, [templateId]);
  return true;
};

exports.removeTagFromTemplate = async function(templateId, tagDefinitionId) {
  const query = `
    UPDATE template_tags 
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE template_id = ? AND ttd_id = ?
    AND deleted_at IS NULL
  `;

  await mysqlQueryRunner.runQueryInMaster(query, [templateId, tagDefinitionId]);
  return true;
};

exports.addTagToTemplate = async function(templateId, tagDefinitionId) {
  // Check if tag is already assigned
  const existingQuery = `
    SELECT tt_id
    FROM template_tags
    WHERE template_id = ? AND ttd_id = ?
    AND deleted_at IS NULL
  `;

  const existing = await mysqlQueryRunner.runQueryInSlave(existingQuery, [templateId, tagDefinitionId]);

  if (existing.length > 0) {
    return true; // Tag already assigned
  }

  // Fetch facet_id from template_tag_definitions
  const fetchFacetQuery = `
    SELECT facet_id
    FROM template_tag_definitions
    WHERE ttd_id = ?
    AND archived_at IS NULL
  `;

  const tagDefinitions = await mysqlQueryRunner.runQueryInSlave(fetchFacetQuery, [tagDefinitionId]);

  if (tagDefinitions.length === 0) {
    throw new Error(`Tag definition ${tagDefinitionId} not found`);
  }

  const facetId = tagDefinitions[0].facet_id;

  // Insert new tag assignment with facet_id
  const query = `
    INSERT INTO template_tags (template_id, ttd_id, facet_id, created_at, updated_at)
    VALUES (?, ?, ?, NOW(), NOW())
  `;

  await mysqlQueryRunner.runQueryInMaster(query, [templateId, tagDefinitionId, facetId]);
  return true;
};

/**
 * Convert special characters to underscores for tag_code searches
 * @param {string} code - Tag code to convert
 * @returns {string} - Converted code with colons and hyphens replaced by underscores
 */
function convertSpecialCharsToUnderscore(code) {
  // Convert colons and hyphens to underscores: 3:4 -> 3_4, non-ai -> non_ai
  return code.replace(/[:]/g, '_').replace(/-/g, '_');
}

exports.getTemplatesByTag = async function(tagCode, pagination = null) {
  // Convert tag code to lowercase and handle special characters
  const convertedTagCode = convertSpecialCharsToUnderscore(tagCode.toLowerCase());
  
  // First get the tag definition ID
  const tagDefinitionQuery = `
    SELECT ttd_id
    FROM template_tag_definitions
    WHERE LOWER(tag_code) = ?
    AND archived_at IS NULL
  `;
  
  const tagDefinitions = await mysqlQueryRunner.runQueryInSlave(tagDefinitionQuery, [convertedTagCode]);
  
  if (tagDefinitions.length === 0) {
    return [];
  }
  
  const ttdId = tagDefinitions[0].ttd_id;
  
  // Get template IDs that have this tag
  let templateIdsQuery = `
    SELECT DISTINCT template_id
    FROM template_tags
    WHERE ttd_id = ?
    AND deleted_at IS NULL
  `;
  
  const templateIds = await mysqlQueryRunner.runQueryInSlave(templateIdsQuery, [ttdId]);
  
  if (templateIds.length === 0) {
    return [];
  }
  
  // Get template details
  const templateIdsList = templateIds.map(t => t.template_id);
  const placeholders = templateIdsList.map(() => '?').join(',');
  
  let query = `
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
      additional_data,
      created_at
    FROM templates
    WHERE template_id IN (${placeholders})
    AND archived_at IS NULL
  `;

  const queryParams = [...templateIdsList];

  if (pagination) {
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    queryParams.push(pagination.limit, pagination.offset);
  } else {
    query += ` ORDER BY created_at DESC`;
  }

  return await mysqlQueryRunner.runQueryInSlave(query, queryParams);
};

exports.getTemplateTagsByTemplateIds = async function(templateIds) {
  if (!templateIds || templateIds.length === 0) {
    return [];
  }

  const placeholders = templateIds.map(() => '?').join(',');
  const query = `
    SELECT 
      template_id,
      tt_id,
      ttd_id,
      created_at,
      updated_at
    FROM template_tags
    WHERE template_id IN (${placeholders})
    AND deleted_at IS NULL
    ORDER BY template_id, created_at ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, templateIds);
};

exports.checkTemplateTagExists = async function(templateId, tagDefinitionId) {
  const query = `
    SELECT tt_id 
    FROM template_tags 
    WHERE template_id = ? AND ttd_id = ?
    AND deleted_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInSlave(query, [templateId, tagDefinitionId]);
  return result.length > 0;
};

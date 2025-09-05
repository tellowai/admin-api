'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.listAllTemplateTagDefinitions = async function() {
  const query = `
    SELECT 
      ttd_id,
      tag_name,
      tag_code,
      tag_description,
      created_at,
      updated_at
    FROM template_tag_definitions
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query);
};

exports.getTemplateTagDefinitionById = async function(tagId) {
  const query = `
    SELECT 
      ttd_id,
      tag_name,
      tag_code,
      tag_description,
      created_at,
      updated_at
    FROM template_tag_definitions
    WHERE ttd_id = ?
    AND deleted_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInSlave(query, [tagId]);
  return result.length > 0 ? result[0] : null;
};

exports.getTemplateTagDefinitionByCode = async function(tagCode) {
  const query = `
    SELECT 
      ttd_id,
      tag_name,
      tag_code,
      tag_description,
      created_at,
      updated_at
    FROM template_tag_definitions
    WHERE tag_code = ?
    AND deleted_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInSlave(query, [tagCode]);
  return result.length > 0 ? result[0] : null;
};

exports.createTemplateTagDefinition = async function(tagData) {
  const query = `
    INSERT INTO template_tag_definitions (
      tag_name,
      tag_code,
      tag_description
    ) VALUES (?, ?, ?)
  `;

  const queryParams = [
    tagData.tag_name,
    tagData.tag_code,
    tagData.tag_description || null
  ];

  const result = await mysqlQueryRunner.runQueryInMaster(query, queryParams);
  
  // Return the created tag
  return await this.getTemplateTagDefinitionById(result.insertId);
};

exports.getTagDefinitionsByCodes = async function(tagCodes) {
  if (!tagCodes || tagCodes.length === 0) {
    return [];
  }

  const placeholders = tagCodes.map(() => '?').join(',');
  const query = `
    SELECT 
      ttd_id,
      tag_name,
      tag_code,
      tag_description,
      created_at,
      updated_at
    FROM template_tag_definitions
    WHERE tag_code IN (${placeholders})
    AND deleted_at IS NULL
    ORDER BY tag_name ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, tagCodes);
};

exports.getTagDefinitionsByIds = async function(tagIds) {
  if (!tagIds || tagIds.length === 0) {
    return [];
  }

  const placeholders = tagIds.map(() => '?').join(',');
  const query = `
    SELECT 
      ttd_id,
      tag_name,
      tag_code,
      tag_description,
      created_at,
      updated_at
    FROM template_tag_definitions
    WHERE ttd_id IN (${placeholders})
    AND deleted_at IS NULL
    ORDER BY tag_name ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, tagIds);
};

exports.getOrCreateTagDefinitions = async function(tagCodes) {
  if (!tagCodes || tagCodes.length === 0) {
    return [];
  }

  // First, get existing tag definitions
  const existingTags = await this.getTagDefinitionsByCodes(tagCodes);
  const existingCodes = new Set(existingTags.map(tag => tag.tag_code));
  
  // Find missing tag codes
  const missingCodes = tagCodes.filter(code => !existingCodes.has(code));
  
  // Create missing tag definitions
  const createdTags = [];
  for (const code of missingCodes) {
    try {
      const tagData = {
        tag_name: code.charAt(0).toUpperCase() + code.slice(1), // Capitalize first letter
        tag_code: code,
        tag_description: `Auto-generated tag for ${code}`
      };
      
      const createdTag = await this.createTemplateTagDefinition(tagData);
      createdTags.push(createdTag);
    } catch (error) {
      // If creation fails (e.g., duplicate), try to get the existing one
      const existingTag = await this.getTemplateTagDefinitionByCode(code);
      if (existingTag) {
        createdTags.push(existingTag);
      }
    }
  }
  
  // Combine existing and created tags
  return [...existingTags, ...createdTags];
};

exports.checkTagDefinitionExists = async function(tagId) {
  const query = `
    SELECT ttd_id 
    FROM template_tag_definitions 
    WHERE ttd_id = ?
    AND deleted_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInSlave(query, [tagId]);
  return result.length > 0;
};

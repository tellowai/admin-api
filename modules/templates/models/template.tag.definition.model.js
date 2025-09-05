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
    WHERE archived_at IS NULL
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
    AND archived_at IS NULL
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
    AND archived_at IS NULL
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
    AND archived_at IS NULL
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
    AND archived_at IS NULL
    ORDER BY tag_name ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, tagIds);
};

/**
 * Convert ratio format for tag_code searches (3:4 -> 3_4)
 * @param {string} code - Tag code to convert
 * @returns {string} - Converted code
 */
function convertRatioForTagCode(code) {
  // Convert ratios like 3:4, 4:3, 16:9, 9:16 to 3_4, 4_3, 16_9, 9_16
  return code.replace(/:/g, '_');
}

exports.getTagDefinitionsByCodes = async function(tagCodes) {
  if (!tagCodes || tagCodes.length === 0) {
    return [];
  }

  // Convert all codes to lowercase and handle ratios for tag_code searches
  const convertedCodes = tagCodes.map(code => {
    const lowerCode = code.toLowerCase();
    return convertRatioForTagCode(lowerCode);
  });
  
  const placeholders = convertedCodes.map(() => '?').join(',');
  const query = `
    SELECT 
      ttd_id,
      tag_name,
      tag_code,
      tag_description,
      created_at,
      updated_at
    FROM template_tag_definitions
    WHERE LOWER(tag_code) IN (${placeholders})
    AND archived_at IS NULL
    ORDER BY tag_name ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, convertedCodes);
};

exports.checkTagDefinitionExists = async function(tagId) {
  const query = `
    SELECT ttd_id 
    FROM template_tag_definitions 
    WHERE ttd_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInSlave(query, [tagId]);
  return result.length > 0;
};

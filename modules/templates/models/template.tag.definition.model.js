'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.listAllTemplateTagDefinitions = async function() {
  const query = `
    SELECT 
      ttd_id,
      tag_name,
      tag_code,
      tag_description,
      facet_id,
      is_active,
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
      facet_id,
      is_active,
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
      facet_id,
      is_active,
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
      tag_description,
      facet_id,
      is_active
    ) VALUES (?, ?, ?, ?, ?)
  `;

  const queryParams = [
    tagData.tag_name,
    tagData.tag_code,
    tagData.tag_description || null,
    tagData.facet_id,
    tagData.is_active !== undefined ? tagData.is_active : 1
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
 * Convert special characters to underscores for tag_code searches
 * @param {string} code - Tag code to convert
 * @returns {string} - Converted code with colons and hyphens replaced by underscores
 */
function convertSpecialCharsToUnderscore(code) {
  // Convert colons and hyphens to underscores: 3:4 -> 3_4, non-ai -> non_ai
  return code.replace(/[:]/g, '_').replace(/-/g, '_');
}

exports.getTagDefinitionsByCodes = async function(tagCodes) {
  if (!tagCodes || tagCodes.length === 0) {
    return [];
  }

  // Convert all codes to lowercase and handle special characters for tag_code searches
  const convertedCodes = tagCodes.map(code => {
    const lowerCode = code.toLowerCase();
    return convertSpecialCharsToUnderscore(lowerCode);
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

exports.listTemplateTagDefinitionsWithPagination = async function(pagination) {
  const query = `
    SELECT 
      ttd_id,
      tag_name,
      tag_code,
      tag_description,
      facet_id,
      is_active,
      created_at,
      updated_at
    FROM template_tag_definitions
    WHERE archived_at IS NULL
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(
    query, 
    [pagination.limit, pagination.offset]
  );
};

exports.updateTemplateTagDefinition = async function(tagId, tagData) {
  // Filter out undefined values and prepare set clause
  const setClause = [];
  const values = [];

  Object.entries(tagData).forEach(([key, value]) => {
    if (value !== undefined) {
      setClause.push(`${key} = ?`);
      values.push(value);
    }
  });

  // Add tagId to values array
  values.push(tagId);

  const query = `
    UPDATE template_tag_definitions 
    SET ${setClause.join(', ')}, updated_at = NOW()
    WHERE ttd_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, values);
  return result.affectedRows > 0;
};

exports.archiveTemplateTagDefinition = async function(tagId) {
  const query = `
    UPDATE template_tag_definitions 
    SET archived_at = NOW()
    WHERE ttd_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, [tagId]);
  return result.affectedRows > 0;
};

exports.bulkArchiveTemplateTagDefinitions = async function(tagIds) {
  const placeholders = tagIds.map(() => '?').join(', ');
  const query = `
    UPDATE template_tag_definitions 
    SET archived_at = NOW()
    WHERE ttd_id IN (${placeholders})
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, tagIds);
  return result.affectedRows;
};

exports.bulkUnarchiveTemplateTagDefinitions = async function(tagIds) {
  const placeholders = tagIds.map(() => '?').join(', ');
  const query = `
    UPDATE template_tag_definitions 
    SET archived_at = NULL
    WHERE ttd_id IN (${placeholders})
    AND archived_at IS NOT NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, tagIds);
  return result.affectedRows;
};

exports.searchTemplateTagDefinitions = async function(searchQuery, pagination) {
  const query = `
    SELECT 
      ttd_id,
      tag_name,
      tag_code,
      tag_description,
      facet_id,
      is_active,
      created_at,
      updated_at
    FROM template_tag_definitions
    WHERE (LOWER(tag_name) LIKE LOWER(?)
    OR LOWER(tag_code) LIKE LOWER(?)
    OR LOWER(tag_description) LIKE LOWER(?))
    AND archived_at IS NULL
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  const searchPattern = `%${searchQuery}%`;
  return await mysqlQueryRunner.runQueryInSlave(
    query, 
    [searchPattern, searchPattern, searchPattern, pagination.limit, pagination.offset]
  );
};

exports.getTemplateTagDefinitionsByIds = async function(ttdIds) {
  if (!ttdIds || ttdIds.length === 0) {
    return [];
  }

  const placeholders = ttdIds.map(() => '?').join(',');
  const query = `
    SELECT 
      ttd_id,
      tag_name,
      tag_code,
      tag_description,
      facet_id,
      is_active,
      created_at,
      updated_at
    FROM template_tag_definitions
    WHERE ttd_id IN (${placeholders})
    AND archived_at IS NULL
    ORDER BY tag_name ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, ttdIds);
};

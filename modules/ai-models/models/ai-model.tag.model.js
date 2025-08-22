'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.listAllAiModelTags = async function() {
  const query = `
    SELECT 
      amtd_id,
      tag_name,
      tag_code,
      tag_description,
      created_at,
      updated_at
    FROM ai_model_tag_definitions
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query);
};

exports.searchAiModelTags = async function(searchParams = {}, paginationParams = null) {
  let query = `
    SELECT 
      amtd_id,
      tag_name,
      tag_code,
      tag_description,
      created_at,
      updated_at
    FROM ai_model_tag_definitions
    WHERE deleted_at IS NULL
  `;

  const queryParams = [];
  const conditions = [];

  // Search by tag names (multiple values supported)
  if (searchParams.tag_names && searchParams.tag_names.length > 0) {
    const tagNameConditions = searchParams.tag_names.map(() => `LOWER(tag_name) LIKE LOWER(?)`);
    conditions.push(`(${tagNameConditions.join(' OR ')})`);
    searchParams.tag_names.forEach(tagName => {
      queryParams.push(`%${tagName}%`);
    });
  }

  // Search by tag codes (multiple values supported)
  if (searchParams.tag_codes && searchParams.tag_codes.length > 0) {
    const tagCodeConditions = searchParams.tag_codes.map(() => `LOWER(tag_code) LIKE LOWER(?)`);
    conditions.push(`(${tagCodeConditions.join(' OR ')})`);
    searchParams.tag_codes.forEach(tagCode => {
      queryParams.push(`%${tagCode}%`);
    });
  }

  // Add conditions to query
  if (conditions.length > 0) {
    query += ` AND ${conditions.join(' AND ')}`;
  }

  // Add pagination if provided
  if (paginationParams) {
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    queryParams.push(paginationParams.limit, paginationParams.offset);
  } else {
    query += ` ORDER BY created_at DESC`;
  }

  const tags = await mysqlQueryRunner.runQueryInSlave(query, queryParams);
  
  return {
    tags
  };
};

exports.getAiModelTagById = async function(tagId) {
  const query = `
    SELECT 
      amtd_id,
      tag_name,
      tag_code,
      tag_description,
      created_at,
      updated_at
    FROM ai_model_tag_definitions
    WHERE amtd_id = ?
    AND deleted_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInSlave(query, [tagId]);
  return result.length > 0 ? result[0] : null;
};

exports.getAiModelTagByCode = async function(tagCode) {
  const query = `
    SELECT 
      amtd_id,
      tag_name,
      tag_code,
      tag_description,
      created_at,
      updated_at
    FROM ai_model_tag_definitions
    WHERE tag_code = ?
    AND deleted_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInSlave(query, [tagCode]);
  return result.length > 0 ? result[0] : null;
};

exports.createAiModelTag = async function(tagData) {
  const query = `
    INSERT INTO ai_model_tag_definitions (
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
  return await this.getAiModelTagById(result.insertId);
};

exports.updateAiModelTag = async function(tagId, updateData) {
  const updateFields = [];
  const queryParams = [];

  if (updateData.tag_name !== undefined) {
    updateFields.push('tag_name = ?');
    queryParams.push(updateData.tag_name);
  }

  if (updateData.tag_code !== undefined) {
    updateFields.push('tag_code = ?');
    queryParams.push(updateData.tag_code);
  }

  if (updateData.tag_description !== undefined) {
    updateFields.push('tag_description = ?');
    queryParams.push(updateData.tag_description);
  }

  if (updateFields.length === 0) {
    return await this.getAiModelTagById(tagId);
  }

  updateFields.push('updated_at = CURRENT_TIMESTAMP');
  queryParams.push(tagId);

  const query = `
    UPDATE ai_model_tag_definitions 
    SET ${updateFields.join(', ')}
    WHERE amtd_id = ?
    AND deleted_at IS NULL
  `;

  await mysqlQueryRunner.runQueryInMaster(query, queryParams);
  
  // Return the updated tag
  return await this.getAiModelTagById(tagId);
};

exports.deleteAiModelTag = async function(tagId) {
  const query = `
    UPDATE ai_model_tag_definitions 
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE amtd_id = ?
    AND deleted_at IS NULL
  `;

  await mysqlQueryRunner.runQueryInMaster(query, [tagId]);
  return true;
};

exports.checkTagExists = async function(tagId) {
  const query = `
    SELECT amtd_id 
    FROM ai_model_tag_definitions 
    WHERE amtd_id = ?
    AND deleted_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInSlave(query, [tagId]);
  return result.length > 0;
};

exports.getTagDefinitionsByIds = async function(tagIds) {
  if (!tagIds || tagIds.length === 0) {
    return [];
  }

  const placeholders = tagIds.map(() => '?').join(',');
  const query = `
    SELECT 
      amtd_id,
      tag_name,
      tag_code,
      tag_description,
      created_at,
      updated_at
    FROM ai_model_tag_definitions
    WHERE amtd_id IN (${placeholders})
    AND deleted_at IS NULL
    ORDER BY tag_name ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, tagIds);
};

exports.searchTagDefinitions = async function(searchParams = {}) {
  let query = `
    SELECT 
      amtd_id,
      tag_name,
      tag_code,
      tag_description,
      created_at,
      updated_at
    FROM ai_model_tag_definitions
    WHERE deleted_at IS NULL
  `;

  const queryParams = [];
  const conditions = [];

  // Search by tag name (case-insensitive)
  if (searchParams.tag_name) {
    conditions.push(`LOWER(tag_name) LIKE LOWER(?)`);
    queryParams.push(`%${searchParams.tag_name}%`);
  }

  // Search by tag code (case-insensitive)
  if (searchParams.tag_code) {
    conditions.push(`LOWER(tag_code) LIKE LOWER(?)`);
    queryParams.push(`%${searchParams.tag_code}%`);
  }

  // Add conditions to query
  if (conditions.length > 0) {
    query += ` AND ${conditions.join(' OR ')}`;
  }

  query += ` ORDER BY tag_name ASC`;

  return await mysqlQueryRunner.runQueryInSlave(query, queryParams);
};

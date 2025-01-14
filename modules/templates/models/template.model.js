'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.listTemplates = async function(pagination) {
  const query = `
    SELECT 
      template_id,
      template_name,
      template_code,
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
'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.createCuratedOnboardingTemplate = async function(templateData) {
  const query = `
    INSERT INTO curated_onboarding_templates (
      template_id,
      is_active
    ) VALUES (?, ?)
  `;
  
  const values = [
    templateData.template_id,
    templateData.is_active !== undefined ? templateData.is_active : 1
  ];

  const result = await mysqlQueryRunner.runQueryInMaster(query, values);
  return result.insertId;
};

exports.getCuratedOnboardingTemplate = async function(cotId) {
  const query = `
    SELECT 
      cot_id,
      template_id,
      is_active,
      created_at,
      updated_at
    FROM curated_onboarding_templates
    WHERE cot_id = ?
    AND archived_at IS NULL
  `;
  
  const [template] = await mysqlQueryRunner.runQueryInSlave(query, [cotId]);
  return template;
};

exports.getCuratedOnboardingTemplateByTemplateId = async function(templateId) {
  const query = `
    SELECT 
      cot_id,
      template_id,
      is_active,
      created_at,
      updated_at
    FROM curated_onboarding_templates
    WHERE template_id = ?
    AND archived_at IS NULL
  `;
  
  const [template] = await mysqlQueryRunner.runQueryInSlave(query, [templateId]);
  return template;
};

exports.listCuratedOnboardingTemplates = async function(paginationParams, filters = {}) {
  let query = `
    SELECT 
      cot_id,
      template_id,
      is_active,
      created_at,
      updated_at
    FROM curated_onboarding_templates
    WHERE archived_at IS NULL
  `;
  
  const values = [];
  
  // Apply filters
  if (filters.is_active !== undefined) {
    query += ` AND is_active = ?`;
    values.push(filters.is_active);
  }
  
  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  values.push(paginationParams.limit, paginationParams.offset);
  
  return await mysqlQueryRunner.runQueryInSlave(query, values);
};

exports.getTemplatesByIds = async function(templateIds) {
  if (!templateIds || templateIds.length === 0) {
    return [];
  }
  
  const placeholders = templateIds.map(() => '?').join(',');
  const query = `
    SELECT 
      template_id,
      template_name,
      template_code,
      template_gender,
      template_output_type,
      cf_r2_url,
      credits
    FROM templates
    WHERE template_id IN (${placeholders})
    AND archived_at IS NULL
  `;
  
  return await mysqlQueryRunner.runQueryInSlave(query, templateIds);
};

exports.updateCuratedOnboardingTemplate = async function(cotId, updateData) {
  // Filter out undefined values and prepare set clause
  const setClause = [];
  const values = [];

  Object.entries(updateData).forEach(([key, value]) => {
    if (value !== undefined) {
      setClause.push(`${key} = ?`);
      values.push(value);
    }
  });

  if (setClause.length === 0) {
    return false;
  }

  // Add cotId to values array
  values.push(cotId);

  const query = `
    UPDATE curated_onboarding_templates
    SET ${setClause.join(', ')}
    WHERE cot_id = ?
    AND archived_at IS NULL
  `;
  
  const result = await mysqlQueryRunner.runQueryInMaster(query, values);
  return result.affectedRows > 0;
};

exports.archiveCuratedOnboardingTemplate = async function(cotId) {
  const query = `
    UPDATE curated_onboarding_templates
    SET archived_at = CURRENT_TIMESTAMP(3)
    WHERE cot_id = ?
    AND archived_at IS NULL
  `;
  
  const result = await mysqlQueryRunner.runQueryInMaster(query, [cotId]);
  return result.affectedRows > 0;
};

exports.bulkCreateCuratedOnboardingTemplates = async function(templateIds, isActive = 1) {
  if (!templateIds || templateIds.length === 0) {
    return [];
  }
  
  // Check for existing templates to avoid duplicates
  const placeholders = templateIds.map(() => '?').join(',');
  const checkQuery = `
    SELECT template_id
    FROM curated_onboarding_templates
    WHERE template_id IN (${placeholders})
    AND archived_at IS NULL
  `;
  
  const existing = await mysqlQueryRunner.runQueryInSlave(checkQuery, templateIds);
  const existingIds = existing.map(e => e.template_id);
  const newIds = templateIds.filter(id => !existingIds.includes(id));
  
  if (newIds.length === 0) {
    return [];
  }
  
  // Bulk insert
  const values = newIds.map(id => [id, isActive]);
  const insertQuery = `
    INSERT INTO curated_onboarding_templates (template_id, is_active)
    VALUES ?
  `;
  
  const result = await mysqlQueryRunner.runQueryInMaster(insertQuery, [values]);
  return {
    inserted: newIds.length,
    skipped: existingIds.length,
    existingIds: existingIds
  };
};

exports.bulkArchiveCuratedOnboardingTemplates = async function(cotIds) {
  if (!cotIds || cotIds.length === 0) {
    return 0;
  }
  
  const placeholders = cotIds.map(() => '?').join(',');
  const query = `
    UPDATE curated_onboarding_templates
    SET archived_at = CURRENT_TIMESTAMP(3)
    WHERE cot_id IN (${placeholders})
    AND archived_at IS NULL
  `;
  
  const result = await mysqlQueryRunner.runQueryInMaster(query, cotIds);
  return result.affectedRows;
};

exports.bulkArchiveByTemplateIds = async function(templateIds) {
  if (!templateIds || templateIds.length === 0) {
    return 0;
  }
  
  const placeholders = templateIds.map(() => '?').join(',');
  const query = `
    UPDATE curated_onboarding_templates
    SET archived_at = CURRENT_TIMESTAMP(3)
    WHERE template_id IN (${placeholders})
    AND archived_at IS NULL
  `;
  
  const result = await mysqlQueryRunner.runQueryInMaster(query, templateIds);
  return result.affectedRows;
};


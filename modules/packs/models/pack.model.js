'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.createPack = async function(packData) {
  const packId = require('uuid').v4();
  const query = `
    INSERT INTO packs (
      pack_id,
      pack_name,
      thumbnail_cf_r2_key,
      thumbnail_cf_r2_url,
      additional_data
    ) VALUES (?, ?, ?, ?, ?)
  `;
  
  const values = [
    packId,
    packData.pack_name,
    packData.thumbnail_cf_r2_key || null,
    packData.thumbnail_cf_r2_url || null,
    JSON.stringify(packData.additional_data || {})
  ];

  await mysqlQueryRunner.runQueryInMaster(query, values);
  return packId;
};

exports.getPack = async function(packId) {
  const query = `
    SELECT 
      pack_id,
      pack_name,
      thumbnail_cf_r2_key,
      thumbnail_cf_r2_url,
      additional_data,
      created_at
    FROM packs
    WHERE pack_id = ?
    AND archived_at IS NULL
  `;
  
  const [pack] = await mysqlQueryRunner.runQueryInSlave(query, [packId]);
  return pack;
};

exports.listPacks = async function(limit = 10, offset = 0) {
  const query = `
    SELECT 
      pack_id,
      pack_name,
      thumbnail_cf_r2_key,
      thumbnail_cf_r2_url,
      additional_data,
      created_at
    FROM packs
    WHERE archived_at IS NULL
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  
  return await mysqlQueryRunner.runQueryInSlave(query, [limit, offset]);
};

exports.updatePack = async function(packId, updateData) {
  // Filter out undefined values and prepare set clause
  const setClause = [];
  const values = [];

  Object.entries(updateData).forEach(([key, value]) => {
    if (value !== undefined) {
      setClause.push(`${key} = ?`);
      values.push(value === null ? null : 
        key === 'additional_data' ? JSON.stringify(value) : value);
    }
  });

  // Add packId to values array
  values.push(packId);

  const query = `
    UPDATE packs
    SET ${setClause.join(', ')}
    WHERE pack_id = ?
    AND archived_at IS NULL
  `;
  
  const result = await mysqlQueryRunner.runQueryInMaster(query, values);
  return result.affectedRows > 0;
};

exports.archivePack = async function(packId) {
  const query = `
    UPDATE packs
    SET archived_at = CURRENT_TIMESTAMP(3)
    WHERE pack_id = ?
    AND archived_at IS NULL
  `;
  
  const result = await mysqlQueryRunner.runQueryInMaster(query, [packId]);
  return result.affectedRows > 0;
};

exports.getPackTemplates = async function(packId) {
  const query = `
    SELECT 
      pack_template_id,
      pack_id,
      template_id,
      sort_order,
      created_at
    FROM pack_templates
    WHERE pack_id = ?
    AND archived_at IS NULL
    ORDER BY sort_order ASC
  `;
  
  return await mysqlQueryRunner.runQueryInSlave(query, [packId]);
};

exports.getTemplatesByIds = async function(templateIds) {
  const query = `
    SELECT 
      template_id,
      template_name,
      thumbnail_url
    FROM templates
    WHERE template_id IN (?)
    AND archived_at IS NULL
  `;
  
  return await mysqlQueryRunner.runQueryInSlave(query, [templateIds]);
};

exports.addTemplateToPackWithOrder = async function(packId, templateId, sortOrder) {
  const query = `
    INSERT INTO pack_templates (
      pack_id,
      template_id,
      sort_order
    ) VALUES (?, ?, ?)
  `;
  
  const result = await mysqlQueryRunner.runQueryInMaster(query, [packId, templateId, sortOrder]);
  return result.affectedRows > 0;
};

exports.removeTemplateFromPack = async function(packId, templateId) {
  const query = `
    UPDATE pack_templates
    SET archived_at = CURRENT_TIMESTAMP(3)
    WHERE pack_id = ?
    AND template_id = ?
    AND archived_at IS NULL
  `;
  
  const result = await mysqlQueryRunner.runQueryInMaster(query, [packId, templateId]);
  return result.affectedRows > 0;
};

exports.countPackTemplates = async function(packId) {
  const query = `
    SELECT COUNT(*) as count
    FROM pack_templates
    WHERE pack_id = ?
    AND archived_at IS NULL
  `;
  
  const [result] = await mysqlQueryRunner.runQueryInSlave(query, [packId]);
  return result.count;
};

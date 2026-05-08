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
      additional_data,
      language_code
    ) VALUES (?, ?, ?, ?, ?, ?)
  `;
  
  const values = [
    packId,
    packData.pack_name,
    packData.thumbnail_cf_r2_key || null,
    packData.thumbnail_cf_r2_url || null,
    JSON.stringify(packData.additional_data || {}),
    packData.language_code || null
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
      language_code,
      credits,
      alacarte_price,
      alacarte_original_price,
      created_at,
      updated_at
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
      language_code,
      credits,
      alacarte_price,
      alacarte_original_price,
      created_at,
      updated_at
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

/**
 * Paginated pack template rows (with optional name/code search).
 * @param {string} packId
 * @param {{ limit: number, offset: number, q?: string }} opts
 */
exports.getPackTemplatesPaginated = async function(packId, opts) {
  const limit = Number(opts.limit) || 20;
  const offset = Number(opts.offset) || 0;
  const q = opts.q != null && String(opts.q).trim() !== '' ? String(opts.q).trim() : null;

  const params = [packId];
  let searchClause = '';
  if (q) {
    const term = `%${q}%`;
    searchClause = ' AND (t.template_name LIKE ? OR t.template_code LIKE ?) ';
    params.push(term, term);
  }
  params.push(limit, offset);

  const query = `
    SELECT 
      pt.pack_template_id,
      pt.pack_id,
      pt.template_id,
      pt.sort_order,
      pt.created_at
    FROM pack_templates pt
    INNER JOIN templates t
      ON t.template_id COLLATE utf8mb4_unicode_ci = pt.template_id COLLATE utf8mb4_unicode_ci
      AND t.archived_at IS NULL
    WHERE pt.pack_id = ?
    AND pt.archived_at IS NULL
    ${searchClause}
    ORDER BY pt.sort_order ASC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, params);
};

/** Count pack templates matching optional name/code search (same filter as paginated list). */
exports.countPackTemplatesMatching = async function(packId, qRaw) {
  const q = qRaw != null && String(qRaw).trim() !== '' ? String(qRaw).trim() : null;
  const params = [packId];
  let searchClause = '';
  if (q) {
    const term = `%${q}%`;
    searchClause = ' AND (t.template_name LIKE ? OR t.template_code LIKE ?) ';
    params.push(term, term);
  }

  const query = `
    SELECT COUNT(*) AS cnt
    FROM pack_templates pt
    INNER JOIN templates t
      ON t.template_id COLLATE utf8mb4_unicode_ci = pt.template_id COLLATE utf8mb4_unicode_ci
      AND t.archived_at IS NULL
    WHERE pt.pack_id = ?
    AND pt.archived_at IS NULL
    ${searchClause}
  `;

  const [row] = await mysqlQueryRunner.runQueryInSlave(query, params);
  return row && row.cnt != null ? Number(row.cnt) : 0;
};

exports.getTemplatesByIds = async function(templateIds) {
  const query = `
    SELECT 
      template_id,
      template_name,
      template_code,
      template_gender,
      description,
      prompt,
      faces_needed,
      cf_r2_key,
      cf_r2_url,
      credits,
      alacarte_price,
      alacarte_original_price,
      additional_data,
      template_output_type,
      created_at
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

exports.updatePackPricing = async function(packId, { credits, alacarte_price, alacarte_original_price }) {
  const query = `
    UPDATE packs
    SET
      credits = ?,
      alacarte_price = ?,
      alacarte_original_price = ?
    WHERE pack_id = ?
    AND archived_at IS NULL
  `;
  await mysqlQueryRunner.runQueryInMaster(query, [
    credits,
    alacarte_price,
    alacarte_original_price,
    packId
  ]);
};

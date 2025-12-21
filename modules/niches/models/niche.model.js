'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.listNiches = async function(pagination) {
  const query = `
    SELECT 
      niche_id,
      niche_name,
      thumb_image_object_key,
      thumb_image_storage_bucket,
      slug,
      display_order,
      is_active,
      created_at,
      updated_at
    FROM template_niches
    WHERE archived_at IS NULL
    ORDER BY display_order ASC, created_at DESC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(
    query, 
    [pagination.limit, pagination.offset]
  );
};

exports.getNicheById = async function(nicheId) {
  const query = `
    SELECT 
      niche_id,
      niche_name,
      thumb_image_object_key,
      thumb_image_storage_bucket,
      slug,
      display_order,
      is_active,
      created_at,
      updated_at
    FROM template_niches
    WHERE niche_id = ?
    AND archived_at IS NULL
  `;

  const [niche] = await mysqlQueryRunner.runQueryInSlave(query, [nicheId]);
  return niche;
};

exports.getNicheBySlug = async function(slug) {
  const query = `
    SELECT 
      niche_id,
      niche_name,
      thumb_image_object_key,
      thumb_image_storage_bucket,
      slug,
      display_order,
      is_active,
      created_at,
      updated_at
    FROM template_niches
    WHERE slug = ?
    AND archived_at IS NULL
  `;

  const [niche] = await mysqlQueryRunner.runQueryInSlave(query, [slug]);
  return niche;
};

exports.createNiche = async function(nicheData) {
  // Filter out undefined and null values and prepare fields and values
  const fields = [];
  const values = [];
  const placeholders = [];

  Object.entries(nicheData).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      fields.push(key);
      values.push(value);
      placeholders.push('?');
    }
  });

  const insertQuery = `
    INSERT INTO template_niches (
      ${fields.join(', ')}
    ) VALUES (${placeholders.join(', ')})
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(insertQuery, values);
  return result;
};

exports.updateNiche = async function(nicheId, nicheData) {
  // Filter out undefined and null values and prepare set clause
  const setClause = [];
  const values = [];

  Object.entries(nicheData).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      setClause.push(`${key} = ?`);
      values.push(value);
    }
  });

  // Add nicheId to values array
  values.push(nicheId);

  const query = `
    UPDATE template_niches 
    SET ${setClause.join(', ')}, updated_at = NOW()
    WHERE niche_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, values);
  return result.affectedRows > 0;
};

exports.archiveNiche = async function(nicheId) {
  const query = `
    UPDATE template_niches 
    SET archived_at = NOW()
    WHERE niche_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, [nicheId]);
  return result.affectedRows > 0;
};

exports.checkNicheExists = async function(nicheId) {
  const query = `
    SELECT niche_id 
    FROM template_niches 
    WHERE niche_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInSlave(query, [nicheId]);
  return result.length > 0;
};


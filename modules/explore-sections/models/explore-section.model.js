'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * @param {object} pagination - limit, offset
 * @param {'explore'|'effects'|null|undefined} listSurface - when set, same filter as consumer API (app_surface NOT NULL)
 */
exports.listExploreSections = async function (pagination, listSurface) {
  let surfaceClause = '';
  if (listSurface === 'explore') {
    surfaceClause = ` AND app_surface = 'explore'`;
  } else if (listSurface === 'effects') {
    surfaceClause = ` AND app_surface = 'effects'`;
  }

  const query = `
    SELECT 
      section_id,
      section_name,
      layout_type,
      section_items_type,
      section_type,
      ui_type,
      sort_order,
      app_surface,
      status,
      additional_data,
      created_at,
      updated_at
    FROM explore_sections
    WHERE archived_at IS NULL
    ${surfaceClause}
    ORDER BY sort_order ASC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(
    query,
    [pagination.limit, pagination.offset]
  );
}; 

exports.createExploreSection = async function(sectionData) {
  // Filter out undefined values and prepare fields and values
  const fields = [];
  const values = [];
  const placeholders = [];

  Object.entries(sectionData).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(key);
      values.push(value === null ? null : 
        key === 'additional_data' ? JSON.stringify(value) : value);
      placeholders.push('?');
    }
  });

  const insertQuery = `
    INSERT INTO explore_sections (
      ${fields.join(', ')}
    ) VALUES (${placeholders.join(', ')})
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(insertQuery, values);
  return result;
};

exports.updateExploreSection = async function(sectionId, sectionData) {
  // Filter out undefined values and prepare set clause
  const setClause = [];
  const values = [];

  Object.entries(sectionData).forEach(([key, value]) => {
    if (value !== undefined) {
      setClause.push(`${key} = ?`);
      values.push(value === null ? null : 
        key === 'additional_data' ? JSON.stringify(value) : value);
    }
  });

  // Add sectionId to values array
  values.push(sectionId);

  const query = `
    UPDATE explore_sections 
    SET ${setClause.join(', ')}
    WHERE section_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, values);
  return result.affectedRows > 0;
};

/**
 * Get a single explore section's meta (no items, no joins). Used to enforce
 * item-type rules per (section_type, ui_type) inside the item controllers.
 * Returns null when archived/missing.
 */
exports.getExploreSectionById = async function(sectionId) {
  const query = `
    SELECT
      section_id,
      section_name,
      section_type,
      ui_type,
      section_items_type,
      app_surface,
      status
    FROM explore_sections
    WHERE section_id = ?
      AND archived_at IS NULL
    LIMIT 1
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [sectionId]);
  return rows && rows.length ? rows[0] : null;
};

exports.archiveExploreSection = async function(sectionId) {
  const query = `
    UPDATE explore_sections 
    SET archived_at = NOW()
    WHERE section_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, [sectionId]);
  return result.affectedRows > 0;
};

exports.updateSortOrders = async function(sortOrderUpdates) {
  // Build CASE statement for each section_id
  const caseStatement = sortOrderUpdates.map(update => 
    `WHEN section_id = ${update.section_id} THEN ${update.sort_order}`
  ).join('\n');

  // Build IN clause with all section_ids
  const sectionIds = sortOrderUpdates.map(update => update.section_id).join(',');

  const query = `
    UPDATE explore_sections 
    SET sort_order = CASE
      ${caseStatement}
    END
    WHERE section_id IN (${sectionIds})
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query);
  return result.affectedRows > 0;
}; 
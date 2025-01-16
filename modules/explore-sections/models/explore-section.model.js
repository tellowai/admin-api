'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.listExploreSections = async function(pagination) {
  const query = `
    SELECT 
      section_id,
      section_name,
      layout_type,
      sort_order,
      status,
      additional_data,
      created_at,
      updated_at
    FROM explore_sections
    WHERE archived_at IS NULL
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
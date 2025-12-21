'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.listNicheDataFieldDefinitions = async function(nicheId, pagination) {
  const query = `
    SELECT 
      ndfd_id,
      niche_id,
      field_code,
      field_label,
      field_data_type,
      is_visible_in_first_time_flow,
      display_order,
      created_at,
      updated_at
    FROM niche_data_field_definitions
    WHERE niche_id = ?
    AND archived_at IS NULL
    ORDER BY display_order ASC, created_at DESC
    LIMIT ? OFFSET ?
  `;

  return await mysqlQueryRunner.runQueryInSlave(
    query, 
    [nicheId, pagination.limit, pagination.offset]
  );
};

exports.getNicheDataFieldDefinitionById = async function(ndfdId) {
  const query = `
    SELECT 
      ndfd_id,
      niche_id,
      field_code,
      field_label,
      field_data_type,
      is_visible_in_first_time_flow,
      display_order,
      created_at,
      updated_at
    FROM niche_data_field_definitions
    WHERE ndfd_id = ?
    AND archived_at IS NULL
  `;

  const [field] = await mysqlQueryRunner.runQueryInSlave(query, [ndfdId]);
  return field;
};

exports.getNicheDataFieldDefinitionsByNicheId = async function(nicheId) {
  const query = `
    SELECT 
      ndfd_id,
      niche_id,
      field_code,
      field_label,
      field_data_type,
      is_visible_in_first_time_flow,
      display_order,
      created_at,
      updated_at
    FROM niche_data_field_definitions
    WHERE niche_id = ?
    AND archived_at IS NULL
    ORDER BY display_order ASC, created_at DESC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [nicheId]);
};

exports.bulkCreateNicheDataFieldDefinitions = async function(fieldsData) {
  if (!fieldsData || fieldsData.length === 0) {
    return { affectedRows: 0, insertIds: [] };
  }

  const fields = ['niche_id', 'field_code', 'field_label', 'field_data_type', 'is_visible_in_first_time_flow', 'display_order'];
  const values = [];
  const placeholders = [];

  fieldsData.forEach(fieldData => {
    const rowValues = [
      fieldData.niche_id,
      fieldData.field_code,
      fieldData.field_label,
      fieldData.field_data_type,
      fieldData.is_visible_in_first_time_flow !== undefined ? fieldData.is_visible_in_first_time_flow : 0,
      fieldData.display_order || null
    ];
    values.push(...rowValues);
    placeholders.push(`(${fields.map(() => '?').join(', ')})`);
  });

  const insertQuery = `
    INSERT INTO niche_data_field_definitions (
      ${fields.join(', ')}
    ) VALUES ${placeholders.join(', ')}
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(insertQuery, values);
  
  // Generate insert IDs
  const insertIds = [];
  for (let i = 0; i < fieldsData.length; i++) {
    insertIds.push(result.insertId + i);
  }

  return {
    affectedRows: result.affectedRows,
    insertIds: insertIds
  };
};

exports.bulkUpdateNicheDataFieldDefinitions = async function(fieldsData) {
  if (!fieldsData || fieldsData.length === 0) {
    return 0;
  }

  let totalAffectedRows = 0;

  // Update each field definition individually
  for (const fieldData of fieldsData) {
    if (!fieldData.ndfd_id) {
      continue; // Skip if no ID provided
    }

    const setClause = [];
    const values = [];

    Object.entries(fieldData).forEach(([key, value]) => {
      if (key !== 'ndfd_id' && value !== undefined && value !== null) {
        setClause.push(`${key} = ?`);
        values.push(value);
      }
    });

    if (setClause.length === 0) {
      continue; // Skip if nothing to update
    }

    values.push(fieldData.ndfd_id);

    const query = `
      UPDATE niche_data_field_definitions 
      SET ${setClause.join(', ')}, updated_at = NOW()
      WHERE ndfd_id = ?
      AND archived_at IS NULL
    `;

    const result = await mysqlQueryRunner.runQueryInMaster(query, values);
    totalAffectedRows += result.affectedRows;
  }

  return totalAffectedRows;
};

exports.archiveNicheDataFieldDefinition = async function(ndfdId) {
  const query = `
    UPDATE niche_data_field_definitions 
    SET archived_at = NOW()
    WHERE ndfd_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, [ndfdId]);
  return result.affectedRows > 0;
};

exports.bulkArchiveNicheDataFieldDefinitions = async function(ndfdIds) {
  if (!ndfdIds || ndfdIds.length === 0) {
    return 0;
  }

  const placeholders = ndfdIds.map(() => '?').join(', ');
  const query = `
    UPDATE niche_data_field_definitions 
    SET archived_at = NOW()
    WHERE ndfd_id IN (${placeholders})
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, ndfdIds);
  return result.affectedRows;
};

exports.checkNicheDataFieldDefinitionExists = async function(ndfdId) {
  const query = `
    SELECT ndfd_id 
    FROM niche_data_field_definitions 
    WHERE ndfd_id = ?
    AND archived_at IS NULL
  `;

  const result = await mysqlQueryRunner.runQueryInSlave(query, [ndfdId]);
  return result.length > 0;
};

exports.checkNicheDataFieldDefinitionsExist = async function(ndfdIds) {
  if (!ndfdIds || ndfdIds.length === 0) {
    return [];
  }

  const placeholders = ndfdIds.map(() => '?').join(',');
  const query = `
    SELECT ndfd_id 
    FROM niche_data_field_definitions 
    WHERE ndfd_id IN (${placeholders})
    AND archived_at IS NULL
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, ndfdIds);
};

exports.getNicheDataFieldDefinitionsByIds = async function(ndfdIds) {
  if (!ndfdIds || ndfdIds.length === 0) {
    return [];
  }

  const placeholders = ndfdIds.map(() => '?').join(',');
  const query = `
    SELECT 
      ndfd_id,
      niche_id,
      field_code,
      field_label,
      field_data_type,
      is_visible_in_first_time_flow,
      display_order,
      created_at,
      updated_at
    FROM niche_data_field_definitions
    WHERE ndfd_id IN (${placeholders})
    AND archived_at IS NULL
    ORDER BY display_order ASC, created_at DESC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, ndfdIds);
};


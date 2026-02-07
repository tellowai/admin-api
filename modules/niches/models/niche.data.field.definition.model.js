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
    return { affectedRows: 0 };
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
      niche_id, field_code, field_label, field_data_type, is_visible_in_first_time_flow, display_order
    ) VALUES ${placeholders.join(', ')}
    ON DUPLICATE KEY UPDATE
      field_label = VALUES(field_label),
      display_order = VALUES(display_order),
      archived_at = NULL
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(insertQuery, values);
  return { affectedRows: result.affectedRows };
};

/**
 * Simple single-table SELECT by niche_id and field_codes, ordered to match fieldCodes.
 * Used by controllers/services after bulkCreate to fetch created/updated rows (stitching in controller).
 */
exports.getByNicheIdAndFieldCodesInOrder = async function(nicheId, fieldCodes) {
  if (!fieldCodes || fieldCodes.length === 0) return [];
  const placeholders = fieldCodes.map(() => '?').join(', ');
  const query = `
    SELECT ndfd_id, niche_id, field_code, field_label, field_data_type,
           is_visible_in_first_time_flow, display_order, created_at, updated_at
    FROM niche_data_field_definitions
    WHERE niche_id = ? AND field_code IN (${placeholders}) AND archived_at IS NULL
    ORDER BY FIELD(field_code, ${placeholders})
  `;
  const rows = await mysqlQueryRunner.runQueryInMaster(query, [nicheId, ...fieldCodes, ...fieldCodes]);
  return rows;
};

exports.bulkUpdateNicheDataFieldDefinitions = async function(fieldsData) {
  if (!fieldsData || fieldsData.length === 0) {
    return 0;
  }

  const validRows = fieldsData.filter(f => f && f.ndfd_id != null);
  if (validRows.length === 0) return 0;

  const updatableColumns = ['field_label', 'field_data_type', 'is_visible_in_first_time_flow', 'display_order'];
  const columnsToUpdate = updatableColumns.filter(col =>
    validRows.some(row => row[col] !== undefined && row[col] !== null)
  );
  if (columnsToUpdate.length === 0) {
    const idPlaceholders = validRows.map(() => '?').join(', ');
    const ids = validRows.map(r => r.ndfd_id);
    const touchQuery = `
      UPDATE niche_data_field_definitions
      SET updated_at = NOW()
      WHERE ndfd_id IN (${idPlaceholders}) AND archived_at IS NULL
    `;
    const result = await mysqlQueryRunner.runQueryInMaster(touchQuery, ids);
    return result.affectedRows;
  }

  const setParts = columnsToUpdate.map(col => {
    const cases = validRows.map(r => `WHEN ? THEN ?`).join(' ');
    return `${col} = CASE ndfd_id ${cases} END`;
  });
  setParts.push('updated_at = NOW()');

  const values = [];
  columnsToUpdate.forEach(col => {
    validRows.forEach(r => {
      values.push(r.ndfd_id, r[col]);
    });
  });
  const idPlaceholders = validRows.map(() => '?').join(', ');
  const ids = validRows.map(r => r.ndfd_id);
  values.push(...ids);

  const query = `
    UPDATE niche_data_field_definitions
    SET ${setParts.join(', ')}
    WHERE ndfd_id IN (${idPlaceholders}) AND archived_at IS NULL
  `;
  const result = await mysqlQueryRunner.runQueryInMaster(query, values);
  return result.affectedRows;
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


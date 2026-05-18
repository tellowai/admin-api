'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * Normalize additional_data for MySQL JSON column (screen_heading, screen_subheading).
 * @param {unknown} data
 * @returns {string|null}
 */
function serializeAdditionalDataForDb(data) {
  if (data == null) return null;
  if (typeof data === 'string') {
    const t = data.trim();
    if (!t) return null;
    try {
      return serializeAdditionalDataForDb(JSON.parse(t));
    } catch {
      return null;
    }
  }
  if (typeof data !== 'object' || Array.isArray(data)) return null;
  const out = {};
  if (data.screen_heading != null && String(data.screen_heading).trim()) {
    out.screen_heading = String(data.screen_heading).trim().slice(0, 200);
  }
  if (data.screen_subheading != null && String(data.screen_subheading).trim()) {
    out.screen_subheading = String(data.screen_subheading).trim().slice(0, 500);
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

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
      additional_data,
      placeholder_text,
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
      additional_data,
      placeholder_text,
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
      additional_data,
      placeholder_text,
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

  const values = [];
  const placeholders = [];
  const rowPlaceholder = '(?, ?, ?, ?, ?, ?, ?, ?)';

  fieldsData.forEach(fieldData => {
    const rowValues = [
      fieldData.niche_id,
      fieldData.field_code,
      fieldData.field_label,
      fieldData.field_data_type,
      fieldData.is_visible_in_first_time_flow !== undefined ? fieldData.is_visible_in_first_time_flow : 0,
      fieldData.display_order || null,
      fieldData.placeholder_text != null && String(fieldData.placeholder_text).trim() !== ''
        ? String(fieldData.placeholder_text).trim().slice(0, 500)
        : null,
      serializeAdditionalDataForDb(fieldData.additional_data)
    ];
    values.push(...rowValues);
    placeholders.push(rowPlaceholder);
  });

  const insertQuery = `
    INSERT INTO niche_data_field_definitions (
      niche_id, field_code, field_label, field_data_type, is_visible_in_first_time_flow, display_order, placeholder_text, additional_data
    ) VALUES ${placeholders.join(', ')}
    ON DUPLICATE KEY UPDATE
      field_label = VALUES(field_label),
      display_order = VALUES(display_order),
      placeholder_text = VALUES(placeholder_text),
      additional_data = VALUES(additional_data),
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
           is_visible_in_first_time_flow, display_order, additional_data, placeholder_text, created_at, updated_at
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

  const updatableColumns = [
    'field_label',
    'field_data_type',
    'is_visible_in_first_time_flow',
    'display_order',
    'placeholder_text',
    'additional_data'
  ];
  const columnsToUpdate = updatableColumns.filter((col) =>
    validRows.some((row) => {
      if (row[col] === undefined) return false;
      if (col === 'placeholder_text' || col === 'additional_data') return true;
      return row[col] !== null;
    })
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
  columnsToUpdate.forEach((col) => {
    validRows.forEach((r) => {
      let v = r[col];
      if (col === 'additional_data') {
        v = serializeAdditionalDataForDb(r.additional_data);
      } else if (col === 'placeholder_text' && v != null) {
        v = String(v).trim().slice(0, 500);
        v = v === '' ? null : v;
      }
      values.push(r.ndfd_id, v);
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
      additional_data,
      placeholder_text,
      created_at,
      updated_at
    FROM niche_data_field_definitions
    WHERE ndfd_id IN (${placeholders})
    AND archived_at IS NULL
    ORDER BY display_order ASC, created_at DESC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, ndfdIds);
};


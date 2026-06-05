'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

function parseJsonField(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapToolRow(row) {
  if (!row) return null;
  return {
    ...row,
    workflow: parseJsonField(row.workflow, {}),
    badges: parseJsonField(row.badges, []),
    category_ids: parseJsonField(row.category_ids, []),
    is_featured: Boolean(row.is_featured),
  };
}

exports.listStudioTools = async function ({ includeInactive = true } = {}) {
  const statusClause = includeInactive ? '' : " AND status = 'active'";
  const query = `
    SELECT
      studio_tool_id,
      tool_key,
      template_id,
      title,
      cta_text,
      eta,
      flow_text,
      icon,
      icon_color,
      icon_image_url,
      workflow,
      badges,
      category_ids,
      is_featured,
      sort_order,
      status,
      created_at,
      updated_at
    FROM studio_tools
    WHERE archived_at IS NULL
    ${statusClause}
    ORDER BY sort_order ASC, created_at ASC
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query);
  return (rows || []).map(mapToolRow);
};

exports.getStudioToolById = async function (studioToolId) {
  const query = `
    SELECT *
    FROM studio_tools
    WHERE studio_tool_id = ?
      AND archived_at IS NULL
    LIMIT 1
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [studioToolId]);
  return mapToolRow(rows && rows[0]);
};

exports.getNextSortOrder = async function () {
  const query = `
    SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort_order
    FROM studio_tools
    WHERE archived_at IS NULL
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query);
  return rows?.[0]?.next_sort_order ?? 1;
};

exports.createStudioTool = async function (toolData) {
  const fields = [];
  const values = [];
  const placeholders = [];

  Object.entries(toolData).forEach(([key, value]) => {
    if (value === undefined) return;
    fields.push(key);
    if (['workflow', 'badges', 'category_ids'].includes(key)) {
      values.push(value == null ? null : JSON.stringify(value));
    } else if (key === 'is_featured') {
      values.push(value ? 1 : 0);
    } else {
      values.push(value);
    }
    placeholders.push('?');
  });

  const query = `
    INSERT INTO studio_tools (${fields.join(', ')})
    VALUES (${placeholders.join(', ')})
  `;
  return mysqlQueryRunner.runQueryInMaster(query, values);
};

exports.updateStudioTool = async function (studioToolId, toolData) {
  const setClause = [];
  const values = [];

  Object.entries(toolData).forEach(([key, value]) => {
    if (value === undefined) return;
    setClause.push(`${key} = ?`);
    if (['workflow', 'badges', 'category_ids'].includes(key)) {
      values.push(value == null ? null : JSON.stringify(value));
    } else if (key === 'is_featured') {
      values.push(value ? 1 : 0);
    } else {
      values.push(value);
    }
  });

  if (!setClause.length) return false;

  values.push(studioToolId);
  const query = `
    UPDATE studio_tools
    SET ${setClause.join(', ')}
    WHERE studio_tool_id = ?
      AND archived_at IS NULL
  `;
  const result = await mysqlQueryRunner.runQueryInMaster(query, values);
  return result.affectedRows > 0;
};

exports.clearFeaturedExcept = async function (studioToolId) {
  const query = `
    UPDATE studio_tools
    SET is_featured = 0
    WHERE studio_tool_id != ?
      AND archived_at IS NULL
  `;
  await mysqlQueryRunner.runQueryInMaster(query, [studioToolId]);
};

exports.archiveStudioTool = async function (studioToolId) {
  const query = `
    UPDATE studio_tools
    SET archived_at = NOW(), is_featured = 0
    WHERE studio_tool_id = ?
      AND archived_at IS NULL
  `;
  const result = await mysqlQueryRunner.runQueryInMaster(query, [studioToolId]);
  return result.affectedRows > 0;
};

exports.getActiveToolIds = async function () {
  const query = `
    SELECT studio_tool_id
    FROM studio_tools
    WHERE archived_at IS NULL
    ORDER BY sort_order ASC
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query);
  return (rows || []).map((row) => row.studio_tool_id);
};

exports.updateSortOrder = async function (toolIds) {
  if (!Array.isArray(toolIds) || toolIds.length === 0) return false;

  const caseParts = toolIds.map((id, index) => `WHEN studio_tool_id = ? THEN ${index + 1}`);
  const query = `
    UPDATE studio_tools
    SET sort_order = CASE
      ${caseParts.join('\n      ')}
    END
    WHERE studio_tool_id IN (${toolIds.map(() => '?').join(',')})
      AND archived_at IS NULL
  `;
  const params = [...toolIds, ...toolIds];
  const result = await mysqlQueryRunner.runQueryInMaster(query, params);
  return result.affectedRows > 0;
};

exports.getPageConfig = async function () {
  const query = `
    SELECT config_id, enabled, title, subtitle, categories, updated_at
    FROM studio_page_config
    WHERE config_id = 1
    LIMIT 1
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query);
  const row = rows?.[0];
  if (!row) return null;
  return {
    ...row,
    enabled: Boolean(row.enabled),
    categories: parseJsonField(row.categories, []),
  };
};

exports.updatePageConfig = async function (configData) {
  const setClause = [];
  const values = [];

  Object.entries(configData).forEach(([key, value]) => {
    if (value === undefined) return;
    setClause.push(`${key} = ?`);
    if (key === 'categories') {
      values.push(JSON.stringify(value));
    } else if (key === 'enabled') {
      values.push(value ? 1 : 0);
    } else {
      values.push(value);
    }
  });

  if (!setClause.length) return false;

  const query = `
    UPDATE studio_page_config
    SET ${setClause.join(', ')}
    WHERE config_id = 1
  `;
  const result = await mysqlQueryRunner.runQueryInMaster(query, values);
  return result.affectedRows > 0;
};

exports.mapToolRow = mapToolRow;

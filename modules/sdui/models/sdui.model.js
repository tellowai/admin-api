'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const crypto = require('crypto');

exports.listScreens = async function(page, limit, status, search) {
  let query = `SELECT * FROM sdui_screens WHERE 1=1`;
  const params = [];

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }
  if (search) {
    query += ` AND (screen_key LIKE ? OR name LIKE ? OR description LIKE ?)`;
    const searchParam = `%${search}%`;
    params.push(searchParam, searchParam, searchParam);
  }

  query += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
  const offset = (page - 1) * limit;
  params.push(limit, offset);

  return await mysqlQueryRunner.runQueryInSlave(query, params);
};

exports.getScreenById = async function(id) {
  const query = `SELECT * FROM sdui_screens WHERE id = ?`;
  const result = await mysqlQueryRunner.runQueryInSlave(query, [id]);
  return result[0] || null;
};

exports.getScreenByKey = async function(screenKey) {
  const query = `SELECT * FROM sdui_screens WHERE screen_key = ?`;
  const result = await mysqlQueryRunner.runQueryInSlave(query, [screenKey]);
  return result[0] || null;
};

exports.getPublishedScreenByKey = async function(screenKey) {
  const query = `SELECT * FROM sdui_screens WHERE screen_key = ? AND status = 'published'`;
  const result = await mysqlQueryRunner.runQueryInSlave(query, [screenKey]);
  return result[0] || null;
};

exports.createScreen = async function(data) {
  const id = crypto.randomUUID();
  const query = `
    INSERT INTO sdui_screens (id, screen_key, name, description, status, body_json, version, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const bodyJson = typeof data.body_json === 'string' ? data.body_json : JSON.stringify(data.body_json);
  const ver = Number.isFinite(Number(data.version)) ? parseInt(data.version, 10) : 1;
  await mysqlQueryRunner.runQueryInMaster(query, [
    id,
    data.screen_key,
    data.name,
    data.description || null,
    data.status || 'draft',
    bodyJson,
    ver,
    data.created_by || null,
    data.updated_by || null
  ]);
  return id;
};

exports.updateScreen = async function(id, updateData) {
  const allowedKeys = ['name', 'description', 'status', 'body_json', 'version', 'updated_by'];
  const filtered = {};
  for (const k of allowedKeys) {
    if (updateData[k] !== undefined) filtered[k] = updateData[k];
  }
  if (filtered.body_json && typeof filtered.body_json !== 'string') {
    filtered.body_json = JSON.stringify(filtered.body_json);
  }
  const keys = Object.keys(filtered);
  if (keys.length === 0) return;
  const setString = keys.map(k => `${k} = ?`).join(', ');
  const params = keys.map(k => filtered[k]);
  params.push(id);
  const query = `UPDATE sdui_screens SET ${setString} WHERE id = ?`;
  await mysqlQueryRunner.runQueryInMaster(query, params);
};

exports.publishScreen = async function(id, publishedBy) {
  const screen = await exports.getScreenById(id);
  if (!screen) return null;
  const bodyJson = typeof screen.body_json === 'string' ? screen.body_json : JSON.stringify(screen.body_json);
  const versionNumber = await exports.getNextVersionNumber(id);
  const versionId = crypto.randomUUID();
  await mysqlQueryRunner.runQueryInMaster(
    `INSERT INTO sdui_screen_versions (id, screen_id, version_number, body_json, published_at, published_by)
     VALUES (?, ?, ?, ?, NOW(), ?)`,
    [versionId, id, versionNumber, bodyJson, publishedBy || null]
  );
  await mysqlQueryRunner.runQueryInMaster(
    `UPDATE sdui_screens SET status = 'published', published_at = NOW(), version = ?, updated_at = NOW() WHERE id = ?`,
    [versionNumber, id]
  );
  return versionId;
};

exports.getNextVersionNumber = async function(screenId) {
  const result = await mysqlQueryRunner.runQueryInSlave(
    `SELECT COALESCE(MAX(version_number), 0) + 1 as next FROM sdui_screen_versions WHERE screen_id = ?`,
    [screenId]
  );
  return result[0]?.next || 1;
};

exports.archiveScreen = async function(id) {
  await mysqlQueryRunner.runQueryInMaster(
    `UPDATE sdui_screens SET status = 'archived', updated_at = NOW() WHERE id = ?`,
    [id]
  );
};

exports.listVersions = async function(screenId) {
  const query = `SELECT * FROM sdui_screen_versions WHERE screen_id = ? ORDER BY version_number DESC`;
  return await mysqlQueryRunner.runQueryInSlave(query, [screenId]);
};

exports.getVersionById = async function(versionId) {
  const query = `SELECT * FROM sdui_screen_versions WHERE id = ?`;
  const result = await mysqlQueryRunner.runQueryInSlave(query, [versionId]);
  return result[0] || null;
};

exports.rollbackToVersion = async function(screenId, versionId, updatedBy) {
  const version = await exports.getVersionById(versionId);
  if (!version || version.screen_id !== screenId) return false;
  const bodyJson = typeof version.body_json === 'string' ? version.body_json : JSON.stringify(version.body_json);
  await mysqlQueryRunner.runQueryInMaster(
    `UPDATE sdui_screens SET body_json = ?, updated_by = ?, updated_at = NOW() WHERE id = ?`,
    [bodyJson, updatedBy || null, screenId]
  );
  return true;
};

exports.duplicateScreen = async function(id, newScreenKey, createdBy) {
  const screen = await exports.getScreenById(id);
  if (!screen) return null;
  const existing = await exports.getScreenByKey(newScreenKey);
  if (existing) return null;
  const v = parseInt(screen.version, 10);
  const newId = await exports.createScreen({
    screen_key: newScreenKey,
    name: `${screen.name} (Copy)`,
    description: screen.description,
    status: 'draft',
    body_json: screen.body_json,
    version: Number.isFinite(v) ? v : 1,
    created_by: createdBy,
    updated_by: createdBy
  });
  return newId;
};

exports.listRegistry = async function(category) {
  let query = `SELECT * FROM sdui_node_registry WHERE is_deprecated = 0`;
  const params = [];
  if (category) {
    query += ` AND category = ?`;
    params.push(category);
  }
  query += ` ORDER BY category, node_type`;
  return await mysqlQueryRunner.runQueryInSlave(query, params);
};

exports.getRegistryById = async function(id) {
  const query = `SELECT * FROM sdui_node_registry WHERE id = ?`;
  const result = await mysqlQueryRunner.runQueryInSlave(query, [id]);
  return result[0] || null;
};

exports.getRegistryByType = async function(nodeType) {
  const query = `SELECT * FROM sdui_node_registry WHERE node_type = ?`;
  const result = await mysqlQueryRunner.runQueryInSlave(query, [nodeType]);
  return result[0] || null;
};

exports.createRegistryEntry = async function(data) {
  const id = crypto.randomUUID();
  const propsSchema = typeof data.props_schema === 'string' ? data.props_schema : JSON.stringify(data.props_schema || {});
  const defaultProps = data.default_props ? (typeof data.default_props === 'string' ? data.default_props : JSON.stringify(data.default_props)) : null;
  const supportedTriggers = data.supported_triggers ? (typeof data.supported_triggers === 'string' ? data.supported_triggers : JSON.stringify(data.supported_triggers)) : null;
  await mysqlQueryRunner.runQueryInMaster(
    `INSERT INTO sdui_node_registry (id, node_type, category, display_name, description, props_schema, default_props, supports_children, supported_triggers)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.node_type, data.category, data.display_name, data.description || null, propsSchema, defaultProps, data.supports_children ? 1 : 0, supportedTriggers]
  );
  return id;
};

exports.updateRegistryEntry = async function(id, updateData) {
  const allowedKeys = ['display_name', 'description', 'props_schema', 'default_props', 'supports_children', 'supported_triggers', 'is_deprecated'];
  const filtered = {};
  for (const k of allowedKeys) {
    if (updateData[k] !== undefined) filtered[k] = updateData[k];
  }
  if (filtered.props_schema && typeof filtered.props_schema !== 'string') filtered.props_schema = JSON.stringify(filtered.props_schema);
  if (filtered.default_props && typeof filtered.default_props !== 'string') filtered.default_props = JSON.stringify(filtered.default_props);
  if (filtered.supported_triggers && typeof filtered.supported_triggers !== 'string') filtered.supported_triggers = JSON.stringify(filtered.supported_triggers);
  const keys = Object.keys(filtered);
  if (keys.length === 0) return;
  const setString = keys.map(k => `${k} = ?`).join(', ');
  const params = keys.map(k => filtered[k]);
  params.push(id);
  await mysqlQueryRunner.runQueryInMaster(`UPDATE sdui_node_registry SET ${setString} WHERE id = ?`, params);
};

exports.deprecateRegistryEntry = async function(id) {
  await mysqlQueryRunner.runQueryInMaster(`UPDATE sdui_node_registry SET is_deprecated = 1 WHERE id = ?`, [id]);
};

// Components - reusable UI compositions referenced by component_key
exports.listComponents = async function(search) {
  let query = `SELECT id, component_key, name, description, version, updated_at FROM sdui_components WHERE 1=1`;
  const params = [];
  if (search) {
    query += ` AND (component_key LIKE ? OR name LIKE ?)`;
    const searchParam = `%${search}%`;
    params.push(searchParam, searchParam);
  }
  query += ` ORDER BY updated_at DESC`;
  return await mysqlQueryRunner.runQueryInSlave(query, params);
};

exports.getComponentById = async function(id) {
  const query = `SELECT * FROM sdui_components WHERE id = ?`;
  const result = await mysqlQueryRunner.runQueryInSlave(query, [id]);
  return result[0] || null;
};

exports.getComponentByKey = async function(componentKey) {
  const query = `SELECT * FROM sdui_components WHERE component_key = ?`;
  const result = await mysqlQueryRunner.runQueryInSlave(query, [componentKey]);
  return result[0] || null;
};

exports.getNextComponentVersionNumber = async function(componentId) {
  const result = await mysqlQueryRunner.runQueryInSlave(
    `SELECT COALESCE(MAX(version_number), 0) + 1 as next FROM sdui_component_versions WHERE component_id = ?`,
    [componentId]
  );
  return result[0]?.next || 1;
};

exports.insertComponentVersionSnapshot = async function(componentId, versionNumber, nodeJson, savedBy) {
  const vid = crypto.randomUUID();
  const nj = typeof nodeJson === 'string' ? nodeJson : JSON.stringify(nodeJson);
  await mysqlQueryRunner.runQueryInMaster(
    `INSERT INTO sdui_component_versions (id, component_id, version_number, node_json, saved_at, saved_by)
     VALUES (?, ?, ?, ?, NOW(), ?)`,
    [vid, componentId, versionNumber, nj, savedBy || null]
  );
  return vid;
};

exports.createComponent = async function(data) {
  const id = crypto.randomUUID();
  const nodeJson = typeof data.node_json === 'string' ? data.node_json : JSON.stringify(data.node_json);
  const startVer = 1;
  await mysqlQueryRunner.runQueryInMaster(
    `INSERT INTO sdui_components (id, component_key, name, description, version, node_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, data.component_key, data.name, data.description || null, startVer, nodeJson]
  );
  await exports.insertComponentVersionSnapshot(id, startVer, nodeJson, data.created_by || null);
  return id;
};

/**
 * Saves component; when node_json changes, auto-increments integer version + appends history row.
 */
exports.updateComponent = async function(id, updateData) {
  const comp = await exports.getComponentById(id);
  if (!comp) return null;

  const hasNode = updateData.node_json !== undefined;
  let nodeJsonStr = null;
  if (hasNode) {
    nodeJsonStr = typeof updateData.node_json === 'string'
      ? updateData.node_json
      : JSON.stringify(updateData.node_json);
  }

  if (!hasNode) {
    const sets = [];
    const params = [];
    if (updateData.name !== undefined) {
      sets.push('name = ?');
      params.push(updateData.name);
    }
    if (updateData.description !== undefined) {
      sets.push('description = ?');
      params.push(updateData.description);
    }
    if (sets.length === 0) return comp;
    params.push(id);
    await mysqlQueryRunner.runQueryInMaster(`UPDATE sdui_components SET ${sets.join(', ')} WHERE id = ?`, params);
    return await exports.getComponentById(id);
  }

  const nextVer = await exports.getNextComponentVersionNumber(id);
  const sets = ['node_json = ?', 'version = ?'];
  const params = [nodeJsonStr, nextVer];
  if (updateData.name !== undefined) {
    sets.push('name = ?');
    params.push(updateData.name);
  }
  if (updateData.description !== undefined) {
    sets.push('description = ?');
    params.push(updateData.description);
  }
  params.push(id);
  await mysqlQueryRunner.runQueryInMaster(
    `UPDATE sdui_components SET ${sets.join(', ')} WHERE id = ?`,
    params
  );
  await exports.insertComponentVersionSnapshot(id, nextVer, nodeJsonStr, updateData.updated_by || null);
  return await exports.getComponentById(id);
};

exports.listComponentVersions = async function(componentId) {
  const q = `SELECT id, component_id, version_number, saved_at, saved_by FROM sdui_component_versions WHERE component_id = ? ORDER BY version_number DESC`;
  return await mysqlQueryRunner.runQueryInSlave(q, [componentId]);
};

exports.getComponentVersionById = async function(versionId) {
  const q = `SELECT * FROM sdui_component_versions WHERE id = ?`;
  const result = await mysqlQueryRunner.runQueryInSlave(q, [versionId]);
  return result[0] || null;
};

exports.rollbackComponentToVersion = async function(componentId, versionId) {
  const row = await exports.getComponentVersionById(versionId);
  if (!row || row.component_id !== componentId) return false;
  const nj = typeof row.node_json === 'string' ? row.node_json : JSON.stringify(row.node_json);
  await mysqlQueryRunner.runQueryInMaster(
    `UPDATE sdui_components SET node_json = ?, updated_at = NOW() WHERE id = ?`,
    [nj, componentId]
  );
  return true;
};

exports.deleteComponent = async function(id) {
  await mysqlQueryRunner.runQueryInMaster(`DELETE FROM sdui_components WHERE id = ?`, [id]);
};

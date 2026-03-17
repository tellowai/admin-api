'use strict';

const SduiModel = require('../models/sdui.model');
const RedisService = require('../../core/models/redis.promise.model');

const SDUI_CACHE_PREFIX = 'sdui:screen:';
const COMPONENT_CACHE_PREFIX = 'sdui:component:';
const MANIFEST_CACHE_KEY = 'sdui:component:manifest';

function buildScreenCacheKey(screenKey, version) {
  return SDUI_CACHE_PREFIX + screenKey + ':' + (version || '');
}

function buildComponentCacheKey(componentKey, version) {
  return COMPONENT_CACHE_PREFIX + componentKey + ':' + (version || '');
}

exports.invalidateScreenCache = async function(screenKey, version) {
  try {
    const cacheKey = buildScreenCacheKey(screenKey, version);
    await RedisService.deleteData(cacheKey);
  } catch (err) {
    console.warn('[SDUI] Redis cache invalidation failed:', err?.message);
  }
};

exports.invalidateComponentCache = async function(componentKey, version) {
  try {
    const cacheKey = buildComponentCacheKey(componentKey, version);
    await RedisService.deleteData(cacheKey);
    await RedisService.deleteData(MANIFEST_CACHE_KEY);
  } catch (err) {
    console.warn('[SDUI] Component Redis cache invalidation failed:', err?.message);
  }
};

exports.listScreens = async function({ page, limit, status, search }) {
  const p = parseInt(page) || 1;
  const l = Math.min(parseInt(limit) || 20, 100);
  const items = await SduiModel.listScreens(p, l, status, search);
  return { data: items };
};

exports.getScreenById = async function(id) {
  return await SduiModel.getScreenById(id);
};

exports.createScreen = async function(data) {
  const existing = await SduiModel.getScreenByKey(data.screen_key);
  if (existing) throw new Error('Screen key already exists');
  const id = await SduiModel.createScreen(data);
  return await SduiModel.getScreenById(id);
};

exports.updateScreen = async function(id, data) {
  const screen = await SduiModel.getScreenById(id);
  if (!screen) throw new Error('Screen not found');
  const updateData = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.body_json !== undefined) updateData.body_json = data.body_json;
  if (data.version !== undefined) updateData.version = data.version;
  if (data.status !== undefined) updateData.status = data.status;
  updateData.updated_by = data.updated_by;
  await SduiModel.updateScreen(id, updateData);
  return await SduiModel.getScreenById(id);
};

exports.archiveScreen = async function(id) {
  const screen = await SduiModel.getScreenById(id);
  if (!screen) throw new Error('Screen not found');
  await SduiModel.archiveScreen(id);
};

exports.publishScreen = async function(id, publishedBy) {
  const screen = await SduiModel.getScreenById(id);
  if (!screen) throw new Error('Screen not found');
  const result = await SduiModel.publishScreen(id, publishedBy);
  let version = screen.version;
  if (!version && screen.body_json) {
    try {
      const body = typeof screen.body_json === 'string' ? JSON.parse(screen.body_json) : screen.body_json;
      version = body?.version;
    } catch {}
  }
  await exports.invalidateScreenCache(screen.screen_key, version || '1.0.0');
  return result;
};

exports.listVersions = async function(screenId) {
  const screen = await SduiModel.getScreenById(screenId);
  if (!screen) throw new Error('Screen not found');
  return await SduiModel.listVersions(screenId);
};

exports.rollbackToVersion = async function(screenId, versionId, updatedBy) {
  const ok = await SduiModel.rollbackToVersion(screenId, versionId, updatedBy);
  if (!ok) throw new Error('Version not found or does not belong to this screen');
  return await SduiModel.getScreenById(screenId);
};

exports.duplicateScreen = async function(id, newScreenKey, createdBy) {
  const screen = await SduiModel.getScreenById(id);
  if (!screen) throw new Error('Screen not found');
  const newId = await SduiModel.duplicateScreen(id, newScreenKey, createdBy);
  if (!newId) throw new Error('Screen key already exists');
  return await SduiModel.getScreenById(newId);
};

exports.listRegistry = async function(category) {
  const items = await SduiModel.listRegistry(category);
  return { data: items };
};

exports.getRegistryById = async function(id) {
  return await SduiModel.getRegistryById(id);
};

exports.createRegistryEntry = async function(data) {
  const existing = await SduiModel.getRegistryByType(data.node_type);
  if (existing) throw new Error('Node type already exists');
  const id = await SduiModel.createRegistryEntry(data);
  return await SduiModel.getRegistryById(id);
};

exports.updateRegistryEntry = async function(id, data) {
  const entry = await SduiModel.getRegistryById(id);
  if (!entry) throw new Error('Registry entry not found');
  const updateData = {};
  if (data.display_name !== undefined) updateData.display_name = data.display_name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.props_schema !== undefined) updateData.props_schema = data.props_schema;
  if (data.default_props !== undefined) updateData.default_props = data.default_props;
  if (data.supports_children !== undefined) updateData.supports_children = data.supports_children;
  if (data.supported_triggers !== undefined) updateData.supported_triggers = data.supported_triggers;
  if (data.is_deprecated !== undefined) updateData.is_deprecated = data.is_deprecated;
  await SduiModel.updateRegistryEntry(id, updateData);
  return await SduiModel.getRegistryById(id);
};

exports.deprecateRegistryEntry = async function(id) {
  const entry = await SduiModel.getRegistryById(id);
  if (!entry) throw new Error('Registry entry not found');
  await SduiModel.deprecateRegistryEntry(id);
};

exports.listComponents = async function(search) {
  const items = await SduiModel.listComponents(search);
  return { data: items };
};

exports.getComponentById = async function(id) {
  return await SduiModel.getComponentById(id);
};

exports.createComponent = async function(data) {
  const existing = await SduiModel.getComponentByKey(data.component_key);
  if (existing) throw new Error('Component key already exists');
  const id = await SduiModel.createComponent(data);
  try { await RedisService.deleteData(MANIFEST_CACHE_KEY); } catch {}
  return await SduiModel.getComponentById(id);
};

exports.updateComponent = async function(id, data) {
  const component = await SduiModel.getComponentById(id);
  if (!component) throw new Error('Component not found');
  const updateData = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.version !== undefined) updateData.version = data.version;
  if (data.node_json !== undefined) updateData.node_json = data.node_json;
  await SduiModel.updateComponent(id, updateData);
  const version = data.version ?? component.version ?? '1.0.0';
  await exports.invalidateComponentCache(component.component_key, version);
  return await SduiModel.getComponentById(id);
};

exports.deleteComponent = async function(id) {
  const component = await SduiModel.getComponentById(id);
  if (!component) throw new Error('Component not found');
  await SduiModel.deleteComponent(id);
  try { await RedisService.deleteData(MANIFEST_CACHE_KEY); } catch {}
};

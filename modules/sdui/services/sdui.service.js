'use strict';

const config = require('../../../config/config');
const SduiModel = require('../models/sdui.model');
const RedisService = require('../../core/models/redis.promise.model');

/** Same as photobop-api SDUI font manifest: public CDN base + assets/... path (templates use cf_r2_key + bucketUrl). */
function resolveRemoteFontPublicUrl(storedUrl) {
  if (!storedUrl || typeof storedUrl !== 'string') return storedUrl || null;
  const bucketUrl = (config.os2?.r2?.public?.bucketUrl || '').replace(/\/$/, '');
  const trimmed = storedUrl.trim();
  if (!bucketUrl) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const path = new URL(trimmed).pathname || '';
      const idx = path.indexOf('/assets/');
      if (idx !== -1) {
        return `${bucketUrl}/${path.slice(idx + 1)}`;
      }
    } catch (_) {
      return trimmed;
    }
    return trimmed;
  }
  const rel = trimmed.replace(/^\/+/, '');
  if (rel.startsWith('assets/')) {
    return `${bucketUrl}/${rel}`;
  }
  return trimmed;
}

function decorateFontRowPublicUrl(row) {
  if (!row || row.source_type !== 'remote_url' || !row.url) return row;
  return { ...row, url: resolveRemoteFontPublicUrl(row.url) };
}

const SDUI_CACHE_PREFIX = 'sdui:screen:';
const COMPONENT_CACHE_PREFIX = 'sdui:component:';
const MANIFEST_CACHE_KEY = 'sdui:component:manifest';
const BLOCK_CACHE_PREFIX = 'sdui:block:';
const BLOCK_MANIFEST_CACHE_KEY = 'sdui:block:manifest';
const FONT_MANIFEST_CACHE_KEY = 'sdui:fonts:manifest:v2';

function buildScreenCacheKey(screenKey, version) {
  return SDUI_CACHE_PREFIX + screenKey + ':' + (version || '');
}

function buildComponentCacheKey(componentKey, version) {
  return COMPONENT_CACHE_PREFIX + componentKey + ':' + (version || '');
}

/** Version string clients use for cache keys / manifest (published snapshot when draft). */
function liveComponentCacheVersion(row) {
  if (!row) return '1';
  if (row.status === 'published') return String(parseInt(row.version, 10) || 1);
  if (row.published_version != null) return String(parseInt(row.published_version, 10) || 1);
  return String(parseInt(row.version, 10) || 1);
}

function liveBlockCacheVersion(row) {
  return liveComponentCacheVersion(row);
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

function buildBlockCacheKey(blockKey, version) {
  return BLOCK_CACHE_PREFIX + blockKey + ':' + (version || '');
}

exports.invalidateBlockCache = async function(blockKey, version) {
  try {
    await RedisService.deleteData(buildBlockCacheKey(blockKey, version));
    await RedisService.deleteData(BLOCK_MANIFEST_CACHE_KEY);
  } catch (err) {
    console.warn('[SDUI] Block Redis cache invalidation failed:', err?.message);
  }
};

exports.listScreens = async function({ page, limit, status, search }) {
  const p = parseInt(page) || 1;
  const l = Math.min(Math.max(parseInt(limit) || 20, 1), 500);
  const items = await SduiModel.listScreens(p, l, status, search);
  /** Listing payloads omit body_json — clients load full document via GET /screens/:id */
  const data = (items || []).map((row) => {
    if (!row || typeof row !== 'object') return row;
    const slim = { ...row };
    delete slim.body_json;
    return slim;
  });
  return { data };
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
  await SduiModel.publishScreen(id, publishedBy);
  const after = await SduiModel.getScreenById(id);
  const version = after?.version ?? screen.version ?? 1;
  await exports.invalidateScreenCache(screen.screen_key, String(version));
  return after;
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
  const updateData = {
    updated_by: data.updated_by,
  };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.node_json !== undefined) updateData.node_json = data.node_json;
  const updated = await SduiModel.updateComponent(id, updateData);
  if (!updated) throw new Error('Component not found');
  await exports.invalidateComponentCache(component.component_key, liveComponentCacheVersion(updated));
  return updated;
};

exports.listComponentVersions = async function(componentId) {
  const component = await SduiModel.getComponentById(componentId);
  if (!component) throw new Error('Component not found');
  return await SduiModel.listComponentVersions(componentId);
};

exports.rollbackComponentToVersion = async function(componentId, versionId) {
  const component = await SduiModel.getComponentById(componentId);
  if (!component) throw new Error('Component not found');
  const ok = await SduiModel.rollbackComponentToVersion(componentId, versionId);
  if (!ok) throw new Error('Version not found or does not belong to this component');
  const after = await SduiModel.getComponentById(componentId);
  await exports.invalidateComponentCache(component.component_key, liveComponentCacheVersion(after));
  return after;
};

exports.publishComponent = async function(id, publishedBy) {
  const before = await SduiModel.getComponentById(id);
  if (!before) throw new Error('Component not found');
  const prevLive = liveComponentCacheVersion(before);
  await SduiModel.publishComponent(id, publishedBy);
  const after = await SduiModel.getComponentById(id);
  try {
    await RedisService.deleteData(buildComponentCacheKey(before.component_key, prevLive));
  } catch (_) {}
  try {
    await RedisService.deleteData(buildComponentCacheKey(after.component_key, liveComponentCacheVersion(after)));
  } catch (_) {}
  try {
    await RedisService.deleteData(MANIFEST_CACHE_KEY);
  } catch (_) {}
  return after;
};

exports.deleteComponent = async function(id) {
  const component = await SduiModel.getComponentById(id);
  if (!component) throw new Error('Component not found');
  await SduiModel.deleteComponent(id);
  try { await RedisService.deleteData(MANIFEST_CACHE_KEY); } catch {}
};

exports.listBlocks = async function(search) {
  const items = await SduiModel.listBlocks(search);
  return { data: items };
};

exports.getBlockById = async function(id) {
  return await SduiModel.getBlockById(id);
};

/** Full row for admin preview / tooling (exact key; avoids list+filter). */
exports.getBlockRowByKey = async function(blockKey) {
  return await SduiModel.getBlockByKey(blockKey);
};

exports.createBlock = async function(data) {
  const existing = await SduiModel.getBlockByKey(data.block_key);
  if (existing) throw new Error('Block key already exists');
  const id = await SduiModel.createBlock(data);
  try { await RedisService.deleteData(BLOCK_MANIFEST_CACHE_KEY); } catch {}
  return await SduiModel.getBlockById(id);
};

exports.updateBlock = async function(id, data) {
  const block = await SduiModel.getBlockById(id);
  if (!block) throw new Error('Block not found');
  const updated = await SduiModel.updateBlock(id, {
    name: data.name,
    description: data.description,
    body_json: data.body_json,
    updated_by: data.updated_by,
  });
  if (!updated) throw new Error('Block not found');
  await exports.invalidateBlockCache(block.block_key, liveBlockCacheVersion(updated));
  return updated;
};

exports.listBlockVersions = async function(blockId) {
  const block = await SduiModel.getBlockById(blockId);
  if (!block) throw new Error('Block not found');
  return await SduiModel.listBlockVersions(blockId);
};

exports.rollbackBlockToVersion = async function(blockId, versionId) {
  const block = await SduiModel.getBlockById(blockId);
  if (!block) throw new Error('Block not found');
  const ok = await SduiModel.rollbackBlockToVersion(blockId, versionId);
  if (!ok) throw new Error('Version not found or does not belong to this block');
  const after = await SduiModel.getBlockById(blockId);
  await exports.invalidateBlockCache(block.block_key, liveBlockCacheVersion(after));
  return after;
};

exports.publishBlock = async function(id, publishedBy) {
  const before = await SduiModel.getBlockById(id);
  if (!before) throw new Error('Block not found');
  const prevLive = liveBlockCacheVersion(before);
  await SduiModel.publishBlock(id, publishedBy);
  const after = await SduiModel.getBlockById(id);
  try {
    await RedisService.deleteData(buildBlockCacheKey(before.block_key, prevLive));
  } catch (_) {}
  try {
    await RedisService.deleteData(buildBlockCacheKey(after.block_key, liveBlockCacheVersion(after)));
  } catch (_) {}
  try {
    await RedisService.deleteData(BLOCK_MANIFEST_CACHE_KEY);
  } catch (_) {}
  return after;
};

exports.deleteBlock = async function(id) {
  const block = await SduiModel.getBlockById(id);
  if (!block) throw new Error('Block not found');
  await SduiModel.deleteBlock(id);
  try { await RedisService.deleteData(BLOCK_MANIFEST_CACHE_KEY); } catch {}
};

async function invalidateFontManifestCache() {
  try {
    await RedisService.deleteData(FONT_MANIFEST_CACHE_KEY);
  } catch (_) {}
}

exports.listFonts = async function() {
  const rows = await SduiModel.listFonts();
  return rows.map(decorateFontRowPublicUrl);
};

exports.createFont = async function(body) {
  const { font_key, display_name, source_type, bundled_family_name, url, sort_order, is_active } = body;
  if (!font_key || !display_name) {
    throw new Error('font_key and display_name are required');
  }
  const st = source_type === 'remote_url' ? 'remote_url' : 'bundled';
  if (st === 'remote_url' && !url) throw new Error('url is required for remote_url fonts');
  if (st === 'bundled' && !bundled_family_name) {
    throw new Error('bundled_family_name is required for bundled fonts (must match app useFonts key)');
  }
  const existing = await SduiModel.getFontByKey(font_key);
  if (existing) throw new Error('font_key already exists');
  const id = await SduiModel.createFont({
    font_key,
    display_name,
    source_type: st,
    bundled_family_name,
    url,
    sort_order,
    is_active,
  });
  await invalidateFontManifestCache();
  return decorateFontRowPublicUrl(await SduiModel.getFontById(id));
};

exports.updateFont = async function(id, body) {
  const row = await SduiModel.getFontById(id);
  if (!row) throw new Error('Font not found');
  const nextKey = body.font_key !== undefined ? body.font_key : row.font_key;
  if (body.font_key !== undefined && body.font_key !== row.font_key) {
    const clash = await SduiModel.getFontByKey(nextKey);
    if (clash && clash.id !== id) throw new Error('font_key already exists');
  }
  const updated = await SduiModel.updateFont(id, body);
  await invalidateFontManifestCache();
  return decorateFontRowPublicUrl(updated);
};

exports.deleteFont = async function(id) {
  const row = await SduiModel.getFontById(id);
  if (!row) throw new Error('Font not found');
  if (row.source_type !== 'remote_url') {
    throw new Error('Bundled fonts cannot be deleted');
  }
  await SduiModel.deleteFont(id);
  await invalidateFontManifestCache();
};

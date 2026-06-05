'use strict';

const { randomUUID } = require('crypto');
const config = require('../../../config/config');
const ScriptFontModel = require('../models/script.font.model');
const { isValidScriptKey } = require('../constants/script-font-registry.constants');
const ScriptFontManifestService = require('./script.font.manifest.service');
const {
  cleanupReplacedFields,
  deleteMediaRefs,
  normalizedMediaRef,
} = require('../../os2/utils/r2-orphan-cleanup.util');
const TemplateRedisService = require('../../templates/services/template.redis.service');
const logger = require('../../../config/lib/logger');

const MAX_FONT_BYTES = 15 * 1024 * 1024;

function allowedBucketsSet() {
  const s = new Set();
  const b = config.os2 && config.os2.r2;
  if (!b) return s;
  if (b.bucket) s.add(b.bucket);
  if (b.public && b.public.bucket) s.add(b.public.bucket);
  if (b.ephemeral && b.ephemeral.bucket) s.add(b.ephemeral.bucket);
  return s;
}

function assertAllowedBucket(bucket) {
  if (!bucket || typeof bucket !== 'string') {
    throw new Error('asset_bucket is required');
  }
  const allowed = allowedBucketsSet();
  if (allowed.size && !allowed.has(bucket)) {
    throw new Error('asset_bucket is not in the allowed list for this environment');
  }
}

function assertFontMagic(buffer) {
  if (!buffer || buffer.length < 4) throw new Error('Invalid font file');
  const a = buffer[0];
  const b = buffer[1];
  if (a === 0x00 && b === 0x01 && buffer[2] === 0x00 && buffer[3] === 0x00) return;
  if (a === 0x4f && b === 0x54 && buffer[2] === 0x54 && buffer[3] === 0x4f) return;
  if (a === 0x77 && b === 0x4f && buffer[2] === 0x46 && buffer[3] === 0x46) return;
  if (a === 0x74 && b === 0x72 && buffer[2] === 0x75 && buffer[3] === 0x65) return;
  throw new Error('File is not a recognized TTF/OTF font');
}

async function validateActivation(assetId) {
  const sources = await ScriptFontModel.listSourcesByAssetId(assetId, { useMaster: true });
  const variable = sources.filter((s) => s.source_kind === 'variable');
  const staticW = sources.filter((s) => s.source_kind === 'static_weight');
  if (variable.length && staticW.length) {
    throw new Error('Cannot mix variable and static_weight sources on the same asset');
  }
  if (variable.length > 1) {
    throw new Error('At most one variable font source is allowed');
  }
  if (variable.length === 1) {
    return;
  }
  const weights = new Set(staticW.map((s) => s.weight).filter((w) => w != null));
  if (!weights.has(400) || !weights.has(700)) {
    throw new Error('static_weight mode requires both 400 and 700 sources before activation');
  }
}

exports.listRegistry = function () {
  const { SCRIPT_FONT_REGISTRY } = require('../constants/script-font-registry.constants');
  return SCRIPT_FONT_REGISTRY;
};

exports.listAssets = async function (query) {
  return ScriptFontModel.listAssets(query || {});
};

exports.getAssetWithSources = async function (id) {
  const asset = await ScriptFontModel.getAssetById(id, { useMaster: false });
  if (!asset) return null;
  const sources = await ScriptFontModel.listSourcesByAssetId(id, { useMaster: false });
  return { ...asset, sources };
};

exports.createAsset = async function (body) {
  if (!body.display_name || !body.css_family_name || !body.script_key) {
    throw new Error('display_name, css_family_name, and script_key are required');
  }
  if (!isValidScriptKey(body.script_key)) {
    throw new Error('Invalid script_key');
  }
  const id = randomUUID();
  await ScriptFontModel.insertAsset({
    id,
    display_name: body.display_name,
    css_family_name: body.css_family_name,
    script_key: body.script_key,
    file_sha256: body.file_sha256 || null,
    status: body.status === 'active' ? 'disabled' : body.status || 'disabled',
    status_note: body.status_note || null
  });
  await ScriptFontManifestService.invalidateManifest();
  await ScriptFontManifestService.buildAndCacheManifest();
  return ScriptFontModel.getAssetById(id, { useMaster: true });
};

exports.updateAsset = async function (id, body) {
  const existing = await ScriptFontModel.getAssetById(id, { useMaster: true });
  if (!existing) throw new Error('Asset not found');
  if (body.script_key !== undefined && !isValidScriptKey(body.script_key)) {
    throw new Error('Invalid script_key');
  }
  const nextStatus = body.status !== undefined ? body.status : existing.status;
  if (nextStatus === 'active') {
    await validateActivation(id);
  }
  if (nextStatus === 'disabled' || nextStatus === 'blocked') {
    await ScriptFontModel.clearDefaultsReferencingAsset(id);
  }
  await ScriptFontModel.updateAsset(id, body);
  await ScriptFontManifestService.invalidateManifest();
  await ScriptFontManifestService.buildAndCacheManifest();
  return ScriptFontModel.getAssetById(id, { useMaster: true });
};

exports.deleteAsset = async function (id) {
  const sources = await ScriptFontModel.listSourcesByAssetId(id, { useMaster: true });
  const refs = sources
    .map((s) => normalizedMediaRef(s.asset_bucket, s.asset_key))
    .filter(Boolean);
  if (refs.length) await deleteMediaRefs(refs, 'script_font_source');
  await ScriptFontModel.clearDefaultsReferencingAsset(id);
  await ScriptFontModel.deleteAsset(id);
  await ScriptFontManifestService.invalidateManifest();
  await ScriptFontManifestService.buildAndCacheManifest();
};

exports.addSource = async function (assetId, body) {
  const asset = await ScriptFontModel.getAssetById(assetId, { useMaster: true });
  if (!asset) throw new Error('Asset not found');
  if (!body.source_kind || !['static_weight', 'variable'].includes(body.source_kind)) {
    throw new Error('source_kind must be static_weight or variable');
  }
  assertAllowedBucket(body.asset_bucket);
  if (!body.asset_key || typeof body.asset_key !== 'string') {
    throw new Error('asset_key is required');
  }
  if (body.source_kind === 'static_weight') {
    const w = Number(body.weight);
    if (!Number.isFinite(w)) throw new Error('weight is required for static_weight');
    body.weight = w;
  } else {
    body.weight = null;
  }
  const sources = await ScriptFontModel.listSourcesByAssetId(assetId, { useMaster: true });
  const hasVar = sources.some((s) => s.source_kind === 'variable');
  const hasStatic = sources.some((s) => s.source_kind === 'static_weight');
  if (body.source_kind === 'variable' && hasStatic) {
    throw new Error('Remove static_weight sources before adding a variable font');
  }
  if (body.source_kind === 'static_weight' && hasVar) {
    throw new Error('Remove variable source before adding static weights');
  }
  if (body.source_kind === 'variable' && hasVar) {
    throw new Error('Only one variable source is allowed');
  }
  if (body.source_kind === 'static_weight') {
    const clash = sources.find((s) => s.source_kind === 'static_weight' && Number(s.weight) === Number(body.weight));
    if (clash) {
      await cleanupReplacedFields(clash, body, [
        {
          keyKey: 'asset_key',
          bucketKey: 'asset_bucket',
          label: 'script_font_source',
        },
      ]);
      await ScriptFontModel.updateSource(clash.id, {
        asset_bucket: body.asset_bucket,
        asset_key: body.asset_key
      });
      await ScriptFontModel.touchAssetUpdatedAt(assetId);
      await ScriptFontManifestService.invalidateManifest();
      await ScriptFontManifestService.buildAndCacheManifest();
      return ScriptFontModel.listSourcesByAssetId(assetId, { useMaster: true });
    }
  }
  const sid = randomUUID();
  await ScriptFontModel.insertSource({
    id: sid,
    font_asset_id: assetId,
    source_kind: body.source_kind,
    weight: body.weight,
    asset_bucket: body.asset_bucket,
    asset_key: body.asset_key
  });
  await ScriptFontModel.touchAssetUpdatedAt(assetId);
  if (asset.status === 'active') {
    try {
      await validateActivation(assetId);
    } catch (e) {
      logger.warn('script-font asset active but sources now incomplete', { assetId, error: e.message });
      await ScriptFontModel.updateAsset(assetId, { status: 'disabled' });
      await ScriptFontModel.clearDefaultsReferencingAsset(assetId);
    }
  }
  await ScriptFontManifestService.invalidateManifest();
  await ScriptFontManifestService.buildAndCacheManifest();
  return ScriptFontModel.listSourcesByAssetId(assetId, { useMaster: true });
};

exports.deleteSource = async function (assetId, sourceId) {
  const sources = await ScriptFontModel.listSourcesByAssetId(assetId, { useMaster: true });
  const source = sources.find((s) => s.id === sourceId);
  if (!source) throw new Error('Source not found');
  const ref = normalizedMediaRef(source.asset_bucket, source.asset_key);
  if (ref) await deleteMediaRefs(ref, 'script_font_source');
  await ScriptFontModel.deleteSource(sourceId);
  await ScriptFontModel.touchAssetUpdatedAt(assetId);
  const asset = await ScriptFontModel.getAssetById(assetId, { useMaster: true });
  if (asset && asset.status === 'active') {
    try {
      await validateActivation(assetId);
    } catch (_) {
      await ScriptFontModel.updateAsset(assetId, { status: 'disabled' });
      await ScriptFontModel.clearDefaultsReferencingAsset(assetId);
    }
  }
  await ScriptFontManifestService.invalidateManifest();
  await ScriptFontManifestService.buildAndCacheManifest();
};

exports.listDefaults = async function () {
  return ScriptFontModel.listDefaults();
};

exports.setDefault = async function (scriptKey, fontAssetId) {
  if (!isValidScriptKey(scriptKey)) throw new Error('Invalid script_key');
  if (fontAssetId == null) {
    await ScriptFontModel.clearDefault(scriptKey);
  } else {
    const asset = await ScriptFontModel.getAssetById(fontAssetId, { useMaster: true });
    if (!asset || asset.status !== 'active') {
      const err = new Error('Default font must reference an active asset');
      err.statusCode = 409;
      throw err;
    }
    await ScriptFontModel.upsertDefault(scriptKey, fontAssetId);
  }
  await ScriptFontManifestService.invalidateManifest();
  await ScriptFontManifestService.buildAndCacheManifest();
};

exports.replaceTemplateOverrides = async function (templateId, overridesMap) {
  const entries = [];
  for (const script_key of Object.keys(overridesMap || {})) {
    if (!isValidScriptKey(script_key)) continue;
    const v = overridesMap[script_key];
    if (v == null) continue;
    const asset = await ScriptFontModel.getAssetById(v, { useMaster: true });
    if (!asset || asset.status !== 'active') {
      const err = new Error('Override must reference an active font asset');
      err.statusCode = 409;
      throw err;
    }
    entries.push({ script_key, font_asset_id: v });
  }
  await ScriptFontModel.replaceTemplateOverrides(templateId, entries);
  await TemplateRedisService.updateTemplateGenerationMeta(templateId);
};

exports.validateUploadedFontBuffer = function (buffer) {
  if (!buffer || buffer.length > MAX_FONT_BYTES) {
    throw new Error('Font file too large');
  }
  assertFontMagic(buffer);
};

exports.MAX_FONT_BYTES = MAX_FONT_BYTES;

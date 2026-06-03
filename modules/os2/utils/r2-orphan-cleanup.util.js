'use strict';

const StorageFactory = require('../providers/storage.factory');
const logger = require('../../../config/lib/logger');

/** @returns {string|null} */
function normalizeStorageObjectKey(key) {
  if (key == null) return null;
  let k = String(key).trim();
  if (!k) return null;
  const q = k.indexOf('?');
  if (q !== -1) k = k.slice(0, q);
  const h = k.indexOf('#');
  if (h !== -1) k = k.slice(0, h);
  return k || null;
}

/**
 * @param {string|null|undefined} bucket
 * @param {string|null|undefined} key
 * @param {string} [defaultBucket='public']
 * @returns {{ bucket: string, key: string } | null}
 */
function normalizedMediaRef(bucket, key, defaultBucket = 'public') {
  const k = normalizeStorageObjectKey(key);
  if (!k) return null;
  const b = bucket != null && String(bucket).trim() !== '' ? String(bucket).trim() : defaultBucket;
  return { bucket: b, key: k };
}

function refSignature(ref) {
  return ref ? `${ref.bucket}::${ref.key}` : '';
}

async function deleteR2RefOnce(storage, dedupe, ref, label) {
  if (!ref) return;
  const sig = refSignature(ref);
  if (dedupe.has(sig)) return;
  dedupe.add(sig);
  try {
    await storage.deleteObjectFromBucket(ref.bucket, ref.key);
  } catch (err) {
    logger.warn('Failed to delete R2 object', {
      label,
      bucket: ref.bucket,
      key: ref.key,
      error: err.message,
    });
  }
}

/**
 * Delete old object when key/bucket changed or cleared. Skips delete if replacement is not yet in R2.
 */
async function deleteReplacedMediaRef(storage, dedupe, oldRef, newRef, label) {
  if (!oldRef) return;
  if (newRef && refSignature(oldRef) === refSignature(newRef)) return;
  if (newRef && !(await storage.objectExistsInBucket(newRef.bucket, newRef.key))) {
    logger.warn('Skipping R2 orphan delete — replacement object not found', {
      label,
      old_key: oldRef.key,
      new_key: newRef.key,
    });
    return;
  }
  await deleteR2RefOnce(storage, dedupe, oldRef, label);
}

function resolveField(existing, patch, field) {
  if (!existing) return patch[field];
  return patch[field] !== undefined ? patch[field] : existing[field];
}

/**
 * @param {object|null} existing
 * @param {object} patch
 * @param {Array<{ keyKey: string, bucketKey?: string|null, defaultBucket?: string, label?: string }>} fields
 */
async function cleanupReplacedFields(existing, patch, fields) {
  if (!existing || !fields?.length || !patch || typeof patch !== 'object') return;
  const storage = StorageFactory.getProvider();
  const dedupe = new Set();

  await Promise.all(
    fields.map(async (field) => {
      const keyInPatch = Object.prototype.hasOwnProperty.call(patch, field.keyKey);
      const bucketInPatch =
        field.bucketKey && Object.prototype.hasOwnProperty.call(patch, field.bucketKey);
      // Only run when the admin PATCH explicitly includes the asset field(s).
      if (!keyInPatch && !bucketInPatch) return;

      const defaultBucket = field.defaultBucket || 'public';
      const bucketKey = field.bucketKey || null;
      const oldRef = normalizedMediaRef(
        bucketKey ? existing[bucketKey] : defaultBucket,
        existing[field.keyKey],
        defaultBucket
      );
      const newBucket = bucketKey ? resolveField(existing, patch, bucketKey) : defaultBucket;
      const newKey = resolveField(existing, patch, field.keyKey);
      const newRef = normalizedMediaRef(newBucket, newKey, defaultBucket);
      await deleteReplacedMediaRef(storage, dedupe, oldRef, newRef, field.label || field.keyKey);
    })
  );
}

/** Unconditional delete (archive / remove). */
async function deleteMediaRefs(refs, labelPrefix = 'asset') {
  const storage = StorageFactory.getProvider();
  const dedupe = new Set();
  const list = Array.isArray(refs) ? refs : [refs];
  await Promise.all(
    list.filter(Boolean).map((ref, i) => deleteR2RefOnce(storage, dedupe, ref, `${labelPrefix}_${i}`))
  );
}

function parseJsonValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_) {
    return null;
  }
}

/** Known remote-config JSON asset field pairs. */
const REMOTE_CONFIG_ASSET_FIELDS = [
  ['image_logo_key', 'image_logo_bucket'],
  ['video_logo_key', 'video_logo_bucket'],
  ['logo_key', 'logo_bucket'],
  ['image_watermark_key', 'image_watermark_bucket'],
  ['outro_video_key', 'outro_video_bucket'],
];

function collectRemoteConfigAssetRefs(configObj) {
  const refs = [];
  if (!configObj || typeof configObj !== 'object') return refs;
  for (const [keyField, bucketField] of REMOTE_CONFIG_ASSET_FIELDS) {
    const ref = normalizedMediaRef(configObj[bucketField], configObj[keyField]);
    if (ref) refs.push(ref);
  }
  return refs;
}

async function cleanupRemoteConfigAssetChange(oldConfigObj, newConfigObj) {
  const storage = StorageFactory.getProvider();
  const dedupe = new Set();
  const oldRefs = collectRemoteConfigAssetRefs(oldConfigObj);
  const newRefs = collectRemoteConfigAssetRefs(newConfigObj);
  const newSigs = new Set(newRefs.map(refSignature));

  await Promise.all(
    oldRefs.map(async (oldRef) => {
      if (newSigs.has(refSignature(oldRef))) return;
      const matchingNew = newRefs.find((r) => r.key === oldRef.key && r.bucket === oldRef.bucket);
      await deleteReplacedMediaRef(storage, dedupe, oldRef, matchingNew || null, 'remote_config_asset');
    })
  );
}

function extractBannerAssetRef(additionalData) {
  const ad = parseJsonValue(additionalData);
  if (!ad || typeof ad !== 'object') return null;
  return normalizedMediaRef(ad.asset_bucket, ad.asset_key);
}

async function cleanupExploreSectionBannerChange(existingSection, patch) {
  if (!patch || patch.additional_data === undefined) return;
  const oldRef = extractBannerAssetRef(existingSection?.additional_data);
  const newRef = extractBannerAssetRef(patch.additional_data);
  const storage = StorageFactory.getProvider();
  await deleteReplacedMediaRef(storage, new Set(), oldRef, newRef, 'explore_banner');
}

/** Walk JSON and collect { asset_key, bucket | asset_bucket } refs. */
function collectAssetRefsFromJson(value, refs = []) {
  if (value == null) return refs;
  if (Array.isArray(value)) {
    value.forEach((item) => collectAssetRefsFromJson(item, refs));
    return refs;
  }
  if (typeof value !== 'object') return refs;
  const key = normalizeStorageObjectKey(value.asset_key);
  if (key) {
    const bucket = value.asset_bucket != null ? value.asset_bucket : value.bucket;
    const ref = normalizedMediaRef(bucket, key);
    if (ref) refs.push(ref);
  }
  Object.values(value).forEach((v) => collectAssetRefsFromJson(v, refs));
  return refs;
}

const CLIP_EXPLICIT_ASSET_FIELDS = [
  ['template_image_asset_key', 'template_image_asset_bucket'],
  ['video_file_asset_key', 'video_file_asset_bucket'],
];

function collectExplicitFieldRefs(source, fieldPairs, refs = []) {
  if (!source || typeof source !== 'object') return refs;
  for (const [keyField, bucketField] of fieldPairs) {
    const ref = normalizedMediaRef(source[bucketField], source[keyField]);
    if (ref) refs.push(ref);
  }
  return refs;
}

/** Legacy clip_workflow steps and clip payloads with explicit asset key fields. */
function collectClipWorkflowAssetRefs(clips, refs = []) {
  if (!Array.isArray(clips)) return refs;
  for (const clip of clips) {
    collectExplicitFieldRefs(clip, CLIP_EXPLICIT_ASSET_FIELDS, refs);
    if (Array.isArray(clip.workflow)) {
      for (const step of clip.workflow) {
        collectExplicitFieldRefs(step, CLIP_EXPLICIT_ASSET_FIELDS, refs);
        collectAssetRefsFromJson(step, refs);
        if (step?.data) collectAssetRefsFromJson(step.data, refs);
      }
    }
  }
  return refs;
}

/** workflow_nodes rows or React Flow node payloads. */
function collectWorkflowNodeAssetRefs(nodes, refs = []) {
  if (!Array.isArray(nodes)) return refs;
  for (const node of nodes) {
    const configValues = node.config_values ?? node.data?.config_values;
    collectAssetRefsFromJson(configValues, refs);
  }
  return refs;
}

/** template_layers rows and/or scene layer payloads. */
function collectLayerAssetRefs(layers, refs = []) {
  if (!Array.isArray(layers)) return refs;
  for (const layer of layers) {
    const key = normalizeStorageObjectKey(layer.asset_key || layer.key);
    if (key) {
      const ref = normalizedMediaRef(layer.asset_bucket || layer.bucket, key);
      if (ref) refs.push(ref);
    }
    const layerConfig = layer.layer_config ?? layer.config;
    if (layerConfig) {
      if (typeof layerConfig === 'string') {
        collectAssetRefsFromJson(parseJsonValue(layerConfig), refs);
      } else {
        collectAssetRefsFromJson(layerConfig, refs);
      }
    }
  }
  return refs;
}

function refsNotInSet(refs, sigSet) {
  return refs.filter((ref) => !sigSet.has(refSignature(ref)));
}

async function deleteRemovedMediaRefSet(oldRefs, newRefs, label = 'asset') {
  const newSigs = new Set((newRefs || []).map(refSignature));
  const removed = refsNotInSet(oldRefs || [], newSigs);
  if (!removed.length) return;
  const storage = StorageFactory.getProvider();
  const dedupe = new Set();
  await Promise.all(
    removed.map(async (ref) => {
      if (!(await storage.objectExistsInBucket(ref.bucket, ref.key))) return;
      await deleteR2RefOnce(storage, dedupe, ref, label);
    })
  );
}

/**
 * Delete old thumb when bucket is unknown (characters may use private or public R2).
 */
async function deleteReplacedMediaRefUnknownBucket(storage, dedupe, oldKey, newRef, label) {
  const oldKeyNorm = normalizeStorageObjectKey(oldKey);
  if (!oldKeyNorm) return;
  if (newRef && normalizeStorageObjectKey(newRef.key) === oldKeyNorm) return;

  for (const bucket of ['private', 'public']) {
    const candidate = normalizedMediaRef(bucket, oldKeyNorm);
    if (await storage.objectExistsInBucket(candidate.bucket, candidate.key)) {
      await deleteReplacedMediaRef(storage, dedupe, candidate, newRef, label);
      return;
    }
  }
  await deleteReplacedMediaRef(
    storage,
    dedupe,
    normalizedMediaRef('private', oldKeyNorm),
    newRef,
    label
  );
}

async function cleanupCharacterThumbChange(existing, patch) {
  if (!existing || patch.thumb_cf_r2_key === undefined) return;
  const storage = StorageFactory.getProvider();
  const dedupe = new Set();
  const newRef = normalizedMediaRef(
    patch.thumb_cf_r2_bucket || 'private',
    patch.thumb_cf_r2_key
  );
  await deleteReplacedMediaRefUnknownBucket(
    storage,
    dedupe,
    existing.thumb_cf_r2_key,
    newRef,
    'character_thumb'
  );
}

async function cleanupRemovedJsonAssets(oldJson, newJson, label = 'json_asset') {
  if (newJson === undefined) return;
  const oldRefs = collectAssetRefsFromJson(parseJsonValue(oldJson));
  const newRefs = collectAssetRefsFromJson(parseJsonValue(newJson));
  const newSigs = new Set(newRefs.map(refSignature));
  const removed = oldRefs.filter((ref) => !newSigs.has(refSignature(ref)));
  if (!removed.length) return;
  const storage = StorageFactory.getProvider();
  const dedupe = new Set();
  await Promise.all(
    removed.map(async (ref) => {
      if (!(await storage.objectExistsInBucket(ref.bucket, ref.key))) return;
      await deleteR2RefOnce(storage, dedupe, ref, label);
    })
  );
}

module.exports = {
  normalizeStorageObjectKey,
  normalizedMediaRef,
  deleteReplacedMediaRef,
  cleanupReplacedFields,
  deleteMediaRefs,
  cleanupRemoteConfigAssetChange,
  cleanupExploreSectionBannerChange,
  extractBannerAssetRef,
  collectAssetRefsFromJson,
  collectClipWorkflowAssetRefs,
  collectWorkflowNodeAssetRefs,
  collectLayerAssetRefs,
  deleteRemovedMediaRefSet,
  cleanupCharacterThumbChange,
  cleanupRemovedJsonAssets,
  parseJsonValue,
};

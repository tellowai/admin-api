'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const axios = require('axios');
const StorageFactory = require('../providers/storage.factory');
const config = require('../../../config/config');
const logger = require('../../../config/lib/logger');
const {
  isMediaAssetKeyUsedByOtherTemplates,
} = require('../../templates/utils/template.media.ref.usage');

const R2_CLEANUP_LOG_TAG = 'R2 asset cleanup';
const r2CleanupEventStorage = new AsyncLocalStorage();

/**
 * @param {{
 *   status: 'deleted'|'delete_failed'|'skipped',
 *   label?: string,
 *   bucket?: string,
 *   key?: string,
 *   reason?: string,
 *   replacement_key?: string,
 *   error?: string,
 * }} event
 */
function logR2AssetCleanup(event) {
  const payload = {
    tag: R2_CLEANUP_LOG_TAG,
    status: event.status,
    label: event.label || 'asset',
    bucket: event.bucket,
    key: event.key,
    ...(event.reason ? { reason: event.reason } : {}),
    ...(event.replacement_key ? { replacement_key: event.replacement_key } : {}),
    ...(event.error ? { error: event.error } : {}),
  };

  const store = r2CleanupEventStorage.getStore();
  if (store?.events) {
    store.events.push(payload);
  }

  if (event.status === 'delete_failed') {
    logger.warn(`${R2_CLEANUP_LOG_TAG}: delete failed`, payload);
    return;
  }
  if (event.status === 'deleted') {
    logger.info(`${R2_CLEANUP_LOG_TAG}: deleted`, payload);
    return;
  }
  logger.info(`${R2_CLEANUP_LOG_TAG}: skipped`, payload);
}

/**
 * Run orphan cleanup and collect per-asset log events for the API response / admin UI console.
 * @param {() => Promise<void>} fn
 * @param {{ excludeTemplateId?: string }} [options] - skip deletes when key is still referenced by another template (e.g. after copy)
 */
async function runWithR2CleanupLog(fn, options = {}) {
  return r2CleanupEventStorage.run({ events: [], ...options }, async () => {
    await fn();
    return r2CleanupEventStorage.getStore()?.events || [];
  });
}

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

/** @param {Array<{ bucket: string, key: string }>} refs */
function buildRefSignatureSet(refs) {
  return new Set((refs || []).filter(Boolean).map(refSignature));
}

function resolveStorageBucketName(storage, bucketAlias) {
  if (storage && typeof storage.resolveBucketName === 'function') {
    return storage.resolveBucketName(bucketAlias);
  }
  if (bucketAlias === 'public') {
    return config.os2?.r2?.public?.bucket || bucketAlias;
  }
  return bucketAlias;
}

function isPublicBucketRef(ref) {
  if (!ref?.bucket) return false;
  const publicBucketName = config.os2?.r2?.public?.bucket;
  return ref.bucket === 'public' || (publicBucketName && ref.bucket === publicBucketName);
}

/** HEAD the public CDN URL — browsers may still play cached copies after R2 delete. */
async function headPublicCdnUrl(ref) {
  const base = String(config.os2?.r2?.public?.bucketUrl || '').replace(/\/$/, '');
  if (!base || !isPublicBucketRef(ref) || !ref.key) return null;
  const cdnUrl = `${base}/${String(ref.key).replace(/^\//, '')}`;
  try {
    const res = await axios.head(cdnUrl, { timeout: 8000, validateStatus: () => true });
    return { cdn_url: cdnUrl, cdn_status: res.status };
  } catch (err) {
    return { cdn_url: cdnUrl, cdn_error: err.message };
  }
}

async function deleteR2RefOnce(storage, dedupe, ref, label, neverDeleteSigs = null) {
  if (!ref) return;
  const sig = refSignature(ref);
  if (neverDeleteSigs && neverDeleteSigs.has(sig)) {
    logR2AssetCleanup({
      status: 'skipped',
      label,
      bucket: ref.bucket,
      key: ref.key,
      reason: 'current_upload_protected',
    });
    return;
  }
  if (dedupe.has(sig)) {
    logR2AssetCleanup({
      status: 'skipped',
      label,
      bucket: ref.bucket,
      key: ref.key,
      reason: 'already_deleted_in_batch',
    });
    return;
  }
  dedupe.add(sig);

  const cleanupCtx = r2CleanupEventStorage.getStore();
  if (cleanupCtx?.excludeTemplateId) {
    try {
      const sharedElsewhere = await isMediaAssetKeyUsedByOtherTemplates(
        ref.key,
        cleanupCtx.excludeTemplateId
      );
      if (sharedElsewhere) {
        logR2AssetCleanup({
          status: 'skipped',
          label,
          bucket: ref.bucket,
          key: ref.key,
          reason: 'shared_with_other_template',
          exclude_template_id: cleanupCtx.excludeTemplateId,
        });
        return;
      }
    } catch (err) {
      logR2AssetCleanup({
        status: 'skipped',
        label,
        bucket: ref.bucket,
        key: ref.key,
        reason: 'shared_ref_check_failed',
        error: err.message,
        exclude_template_id: cleanupCtx.excludeTemplateId,
      });
      return;
    }
  }

  let exists = true;
  try {
    exists = await storage.objectExistsInBucket(ref.bucket, ref.key);
  } catch (err) {
    logR2AssetCleanup({
      status: 'delete_failed',
      label,
      bucket: ref.bucket,
      key: ref.key,
      reason: 'existence_check_failed',
      error: err.message,
    });
    return;
  }

  if (!exists) {
    logR2AssetCleanup({
      status: 'skipped',
      label,
      bucket: ref.bucket,
      key: ref.key,
      reason: 'not_in_bucket',
    });
    return;
  }

  try {
    await storage.deleteObjectFromBucket(ref.bucket, ref.key);
    let stillExists = false;
    try {
      stillExists = await storage.objectExistsInBucket(ref.bucket, ref.key);
    } catch (verifyErr) {
      logR2AssetCleanup({
        status: 'delete_failed',
        label,
        bucket: ref.bucket,
        key: ref.key,
        reason: 'post_delete_verify_failed',
        error: verifyErr.message,
      });
      return;
    }
    if (stillExists) {
      logR2AssetCleanup({
        status: 'delete_failed',
        label,
        bucket: ref.bucket,
        key: ref.key,
        reason: 'still_exists_after_delete',
        resolved_bucket: resolveStorageBucketName(storage, ref.bucket),
      });
      return;
    }
    const cdnVerify = await headPublicCdnUrl(ref);
    const deleteEvent = {
      status: 'deleted',
      label,
      bucket: ref.bucket,
      key: ref.key,
      resolved_bucket: resolveStorageBucketName(storage, ref.bucket),
      ...(cdnVerify?.cdn_url ? { cdn_url: cdnVerify.cdn_url } : {}),
      ...(cdnVerify?.cdn_status != null ? { cdn_status: cdnVerify.cdn_status } : {}),
      ...(cdnVerify?.cdn_error ? { cdn_error: cdnVerify.cdn_error } : {}),
    };
    if (cdnVerify?.cdn_status != null && cdnVerify.cdn_status !== 404 && cdnVerify.cdn_status !== 410) {
      deleteEvent.cdn_cache_note =
        'R2 object removed but CDN still returns asset; browser may also cache immutable media for up to 1 year';
      logger.warn(`${R2_CLEANUP_LOG_TAG}: deleted from R2 but CDN still serves`, deleteEvent);
    }
    logR2AssetCleanup(deleteEvent);
  } catch (err) {
    logR2AssetCleanup({
      status: 'delete_failed',
      label,
      bucket: ref.bucket,
      key: ref.key,
      error: err.message,
    });
  }
}

/**
 * Delete previous object when key/bucket changed or cleared.
 * Never deletes newRef. When the PATCH names a new key, trust it and remove the previous key.
 */
async function deleteReplacedMediaRef(storage, dedupe, oldRef, newRef, label, neverDeleteSigs = null) {
  if (!oldRef) return;
  if (newRef && refSignature(oldRef) === refSignature(newRef)) {
    logR2AssetCleanup({
      status: 'skipped',
      label,
      bucket: oldRef.bucket,
      key: oldRef.key,
      reason: 'unchanged_key',
      replacement_key: newRef.key,
    });
    return;
  }
  const patchConfirmsNewUpload =
    newRef && neverDeleteSigs && neverDeleteSigs.has(refSignature(newRef));
  if (
    newRef &&
    !patchConfirmsNewUpload &&
    !(await storage.objectExistsInBucket(newRef.bucket, newRef.key))
  ) {
    logR2AssetCleanup({
      status: 'skipped',
      label,
      bucket: oldRef.bucket,
      key: oldRef.key,
      reason: 'replacement_not_in_bucket',
      replacement_key: newRef.key,
    });
    return;
  }
  await deleteR2RefOnce(storage, dedupe, oldRef, label, neverDeleteSigs);
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
async function cleanupReplacedFields(existing, patch, fields, neverDeleteSigs = null) {
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
      await deleteReplacedMediaRef(
        storage,
        dedupe,
        oldRef,
        newRef,
        field.label || field.keyKey,
        neverDeleteSigs
      );
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

function layerMediaSlotKey(sceneOrder, zIndex) {
  return `${sceneOrder}:${zIndex}`;
}

/** Align with template_scenes.scene_order default: scene.scene_order || (i + 1). */
function resolveSceneOrder(scene, sceneIndex) {
  if (scene?.scene_order != null && scene.scene_order !== '') {
    return Number(scene.scene_order);
  }
  return sceneIndex + 1;
}

function resolveLayerZIndex(layer) {
  const z = layer?.z_index;
  return z != null && z !== '' ? Number(z) : null;
}

/** Slot id shared by DB snapshot + PATCH (single-scene templates use z-index only). */
function resolveLayerSlotKey(scene, sceneIndex, zIndex, sceneCount) {
  if (sceneCount === 1) {
    return layerMediaSlotKey('z', zIndex);
  }
  return layerMediaSlotKey(resolveSceneOrder(scene, sceneIndex), zIndex);
}

const LAYER_TYPES_WITH_R2_MEDIA = new Set(['video_transparent_webm', 'video_webm']);

/** DB layer row or PATCH layer — only the layer's own asset_key (not nested layer_config). */
function layerRowMediaRef(layer) {
  if (!layer || typeof layer !== 'object') return null;
  return normalizedMediaRef(layer.asset_bucket || layer.bucket, layer.asset_key || layer.key);
}

/**
 * Per timeline slot, the media ref PATCH assigns (null = cleared).
 * Every video_transparent_webm / video_webm row in scenes is explicit.
 */
function buildLayerSlotMapFromScenesPayload(scenes) {
  const map = new Map();
  if (!Array.isArray(scenes)) return map;
  const sceneCount = scenes.length;
  scenes.forEach((scene, sceneIndex) => {
    (scene.layers || []).forEach((layer) => {
      if (!LAYER_TYPES_WITH_R2_MEDIA.has(layer.layer_type)) return;
      const zIndex = resolveLayerZIndex(layer);
      if (zIndex == null) return;
      const slot = resolveLayerSlotKey(scene, sceneIndex, zIndex, sceneCount);
      const ref = layerRowMediaRef(layer);
      map.set(slot, { explicit: true, ref: ref || null });
    });
  });
  return map;
}

/** DB snapshot slots for layers that currently hold an asset key. */
function buildLayerSlotMapFromDbLayers(scenes, layers) {
  const map = new Map();
  if (!Array.isArray(scenes) || !Array.isArray(layers) || !scenes.length) return map;
  const sceneCount = scenes.length;
  const orderBySceneId = new Map(scenes.map((s) => [s.scene_id, s.scene_order]));
  for (const layer of layers) {
    if (!LAYER_TYPES_WITH_R2_MEDIA.has(layer.layer_type)) continue;
    const sceneOrder = orderBySceneId.get(layer.scene_id);
    if (sceneOrder == null) continue;
    const zIndex = resolveLayerZIndex(layer);
    if (zIndex == null) continue;
    const ref = layerRowMediaRef(layer);
    if (!ref) continue;
    const sceneIndex = scenes.findIndex((s) => s.scene_id === layer.scene_id);
    const slot = resolveLayerSlotKey(
      { scene_order: sceneOrder },
      sceneIndex >= 0 ? sceneIndex : 0,
      zIndex,
      sceneCount
    );
    map.set(slot, ref);
  }
  return map;
}

/**
 * Replace layer media per slot: delete previous key only when PATCH names a different key (or null).
 * Never uses global set-diff (which deleted newly uploaded keys on follow-up saves).
 */
async function cleanupReplacedLayerAssetsBySlot(oldSlotMap, newSlotMap, neverDeleteSigs = null) {
  if (!oldSlotMap?.size) return;
  const storage = StorageFactory.getProvider();
  const dedupe = new Set();

  logger.info('R2 layer cleanup: comparing slots', {
    tag: R2_CLEANUP_LOG_TAG,
    old_slot_count: oldSlotMap.size,
    patch_slot_count: newSlotMap?.size ?? 0,
    patch_slots: [...(newSlotMap || new Map()).keys()].join(','),
  });

  for (const [slot, oldRef] of oldSlotMap.entries()) {
    let entry = newSlotMap.get(slot);
    if (!entry?.explicit) {
      const zPart = slot.split(':')[1];
      if (zPart) {
        for (const [newSlot, newEntry] of newSlotMap.entries()) {
          if (newEntry?.explicit && newSlot.endsWith(`:${zPart}`)) {
            entry = newEntry;
            break;
          }
        }
      }
    }
    if (!entry?.explicit) {
      logR2AssetCleanup({
        status: 'skipped',
        label: 'template_layer_asset',
        bucket: oldRef.bucket,
        key: oldRef.key,
        reason: 'layer_slot_not_in_patch',
        replacement_key: slot,
        patch_slots: [...newSlotMap.keys()].join(','),
      });
      continue;
    }
    const newRef = entry.ref;
    if (newRef && refSignature(newRef) === refSignature(oldRef)) {
      logR2AssetCleanup({
        status: 'skipped',
        label: 'template_layer_asset',
        bucket: oldRef.bucket,
        key: oldRef.key,
        reason: 'unchanged_key',
        replacement_key: newRef.key,
      });
      continue;
    }
    logger.info('R2 layer cleanup: replacing slot media', {
      tag: R2_CLEANUP_LOG_TAG,
      slot,
      old_key: oldRef.key,
      new_key: newRef?.key ?? null,
    });
    await deleteReplacedMediaRef(
      storage,
      dedupe,
      oldRef,
      newRef,
      'template_layer_asset',
      neverDeleteSigs
    );
  }
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

/**
 * Delete refs present in oldRefs but not in newRefs (same slot / JSON tree).
 * Never deletes refs in neverDeleteSigs (current uploads from PATCH + unchanged row fields).
 */
async function deleteRemovedMediaRefSet(oldRefs, newRefs, label = 'asset', neverDeleteSigs = null) {
  const newSigs = buildRefSignatureSet(newRefs);
  const removed = refsNotInSet(oldRefs || [], newSigs);
  if (!removed.length) return;
  const storage = StorageFactory.getProvider();
  const dedupe = new Set();
  await Promise.all(
    removed.map(async (ref) => deleteR2RefOnce(storage, dedupe, ref, label, neverDeleteSigs))
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

async function cleanupRemovedJsonAssets(oldJson, newJson, label = 'json_asset', neverDeleteSigs = null) {
  if (newJson === undefined) return;
  const oldRefs = collectAssetRefsFromJson(parseJsonValue(oldJson));
  const newRefs = collectAssetRefsFromJson(parseJsonValue(newJson));
  const newSigs = buildRefSignatureSet(newRefs);
  const removed = oldRefs.filter((ref) => !newSigs.has(refSignature(ref)));
  if (!removed.length) return;
  const storage = StorageFactory.getProvider();
  const dedupe = new Set();
  await Promise.all(
    removed.map(async (ref) => deleteR2RefOnce(storage, dedupe, ref, label, neverDeleteSigs))
  );
}

/** Template row media columns — keys in PATCH are current uploads; omitted columns keep existing refs. */
const TEMPLATE_ROW_MEDIA_FIELD_DEFS = [
  { keyKey: 'cf_r2_key', bucketKey: 'cf_r2_bucket', defaultBucket: 'public' },
  { keyKey: 'thumb_frame_asset_key', bucketKey: 'thumb_frame_bucket', defaultBucket: 'public' },
  { keyKey: 'color_video_key', bucketKey: 'color_video_bucket', defaultBucket: 'public' },
  { keyKey: 'mask_video_key', bucketKey: 'mask_video_bucket', defaultBucket: 'public' },
  {
    keyKey: 'transparent_webm_video_key',
    bucketKey: 'transparent_webm_video_bucket',
    defaultBucket: 'public',
  },
  { keyKey: 'bodymovin_json_key', bucketKey: 'bodymovin_json_bucket', defaultBucket: 'public' },
  { keyKey: 'hero_preview_png_key', bucketKey: 'hero_preview_png_bucket', defaultBucket: 'public' },
];

/**
 * Signatures that must not be deleted: new keys from PATCH + unchanged template-row / JSON refs.
 * Does not read DB (avoids master/slave lag blocking legitimate orphan deletes).
 */
function buildNeverDeleteSigsFromPatch(patch, existing = null) {
  const refs = [];
  if (!patch || typeof patch !== 'object') {
    return buildRefSignatureSet(refs);
  }

  for (const field of TEMPLATE_ROW_MEDIA_FIELD_DEFS) {
    const keyInPatch = Object.prototype.hasOwnProperty.call(patch, field.keyKey);
    const bucketInPatch =
      field.bucketKey && Object.prototype.hasOwnProperty.call(patch, field.bucketKey);
    if (keyInPatch || bucketInPatch) {
      const bucket = bucketInPatch
        ? patch[field.bucketKey]
        : (existing?.[field.bucketKey] ?? field.defaultBucket);
      const key = keyInPatch ? patch[field.keyKey] : existing?.[field.keyKey];
      const ref = normalizedMediaRef(bucket, key, field.defaultBucket);
      if (ref) refs.push(ref);
    } else if (existing) {
      const ref = normalizedMediaRef(
        existing[field.bucketKey],
        existing[field.keyKey],
        field.defaultBucket
      );
      if (ref) refs.push(ref);
    }
  }

  if (Array.isArray(patch.scenes)) {
    const layerSlots = buildLayerSlotMapFromScenesPayload(patch.scenes);
    for (const entry of layerSlots.values()) {
      if (entry.ref) refs.push(entry.ref);
    }
  }

  if (patch.custom_text_input_fields !== undefined) {
    collectAssetRefsFromJson(parseJsonValue(patch.custom_text_input_fields), refs);
  } else if (existing?.custom_text_input_fields) {
    collectAssetRefsFromJson(parseJsonValue(existing.custom_text_input_fields), refs);
  }

  if (patch.image_input_fields_json !== undefined) {
    collectAssetRefsFromJson(parseJsonValue(patch.image_input_fields_json), refs);
  } else if (existing?.image_input_fields_json) {
    collectAssetRefsFromJson(parseJsonValue(existing.image_input_fields_json), refs);
  }

  if (patch.clips !== undefined) {
    collectClipWorkflowAssetRefs(patch.clips || [], refs);
  }

  return buildRefSignatureSet(refs);
}

module.exports = {
  logR2AssetCleanup,
  runWithR2CleanupLog,
  refSignature,
  buildRefSignatureSet,
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
  layerMediaSlotKey,
  layerRowMediaRef,
  resolveSceneOrder,
  resolveLayerZIndex,
  resolveLayerSlotKey,
  buildLayerSlotMapFromScenesPayload,
  buildLayerSlotMapFromDbLayers,
  cleanupReplacedLayerAssetsBySlot,
  deleteRemovedMediaRefSet,
  cleanupCharacterThumbChange,
  cleanupRemovedJsonAssets,
  parseJsonValue,
  TEMPLATE_ROW_MEDIA_FIELD_DEFS,
  buildNeverDeleteSigsFromPatch,
};

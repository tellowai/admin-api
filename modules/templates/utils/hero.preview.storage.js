'use strict';

const { createId } = require('@paralleldrive/cuid2');
const config = require('../../../config/config');
const {
  buildRefSignatureSet,
  deleteReplacedMediaRef,
  normalizedMediaRef,
  refSignature,
} = require('../../os2/utils/r2-orphan-cleanup.util');

/**
 * Unique public-bucket key — same pattern as presigned uploads (`assetsPrefix` + cuid + ext).
 * Never reuse a key so CDN / client caches cannot serve a stale hero frame.
 */
function buildHeroPreviewPngStorageKey(uniqueId = createId()) {
  const prefix = String(config.os2?.r2?.assetsPrefix || 'public/assets/');
  const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const id = String(uniqueId || createId()).trim() || createId();
  return `${normalizedPrefix}${id}.png`;
}

/**
 * Delete the previous hero PNG only after the replacement is confirmed in R2.
 * Uses the same safeguards as template PATCH cleanup (neverDeleteSigs + replacement_exists).
 */
async function cleanupReplacedHeroPreviewPng(storage, { oldBucket, oldKey, newBucket, newKey }) {
  const oldRef = normalizedMediaRef(oldBucket, oldKey, 'public');
  const newRef = normalizedMediaRef(newBucket, newKey, 'public');
  if (!newRef) {
    return { deleted: false, reason: 'new_ref_missing' };
  }
  if (!oldRef) {
    return { deleted: false, reason: 'no_previous_asset' };
  }
  if (refSignature(oldRef) === refSignature(newRef)) {
    return { deleted: false, reason: 'unchanged_key' };
  }

  const newExists = await storage.objectExistsInBucket(newRef.bucket, newRef.key);
  if (!newExists) {
    return { deleted: false, reason: 'new_not_in_bucket' };
  }

  const neverDeleteSigs = buildRefSignatureSet([newRef]);
  await deleteReplacedMediaRef(
    storage,
    new Set(),
    oldRef,
    newRef,
    'hero_preview_png',
    neverDeleteSigs,
  );
  return { deleted: true, oldKey: oldRef.key, newKey: newRef.key };
}

module.exports = {
  buildHeroPreviewPngStorageKey,
  cleanupReplacedHeroPreviewPng,
};

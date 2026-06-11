'use strict';

const config = require('../../../config/config');

/**
 * R2 S3 API endpoints are not browser-playable CDN URLs.
 */
function isR2ApiStyleBase(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  if (lower.includes('.r2.cloudflarestorage.com')) return true;
  if (/\/\/r2-[^./]+\./.test(lower)) return true;
  if (lower.includes('photobop.co') && !lower.includes('public.assets') && !lower.includes('local.public')) {
    return true;
  }
  return false;
}

function originFromAssetUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    if (!u.pathname.includes('/assets/')) return '';
    return u.origin;
  } catch {
    return '';
  }
}

/**
 * Resolve the public CDN base used for GET (not presigned PUT hosts).
 */
function getPublicBucketBaseUrl(hintUrls = []) {
  const candidates = [
    config.os2?.r2?.public?.bucketUrl,
    process.env.PUBLIC_ASSETS_CDN_BASE_URL,
    process.env.R2_PUBLIC_CDN_URL,
    ...(Array.isArray(hintUrls) ? hintUrls.map(originFromAssetUrl) : [])
  ].filter(Boolean);

  for (const raw of candidates) {
    const base = String(raw).replace(/\/$/, '');
    if (base && !isR2ApiStyleBase(base)) {
      return base;
    }
  }

  const configured = String(config.os2?.r2?.public?.bucketUrl || '').replace(/\/$/, '');
  return configured || '';
}

function buildPublicAssetUrl(assetKey, hintUrls = []) {
  if (!assetKey) return null;
  const base = getPublicBucketBaseUrl(hintUrls);
  if (!base || isR2ApiStyleBase(base)) return null;
  const key = String(assetKey).replace(/^\//, '');
  return `${base}/${key}`;
}

module.exports = {
  isR2ApiStyleBase,
  originFromAssetUrl,
  getPublicBucketBaseUrl,
  buildPublicAssetUrl
};

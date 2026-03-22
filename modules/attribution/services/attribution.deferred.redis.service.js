'use strict';

/**
 * Invalidates photobop-api GET /attribution/deferred/:linkId Redis cache.
 * Key must match photobop-api `attribution.deferred.service.js` (same projectPrefix + suffix).
 */

const RedisService = require('../../core/models/redis.promise.model');

const REDIS_KEY_SUFFIX = 'attribution:deferred:link:';

/**
 * @param {string} linkId — tracking_links.id (UUID)
 */
async function invalidateDeferredLinkCache(linkId) {
  if (linkId == null || linkId === '') return;
  const id = String(linkId).trim();
  if (!id) return;
  try {
    await RedisService.deleteData(REDIS_KEY_SUFFIX + id);
  } catch (e) {
    /* non-fatal — DB is source of truth */
  }
}

module.exports = {
  invalidateDeferredLinkCache
};

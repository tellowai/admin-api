'use strict';

const RedisService = require('../../core/models/redis.promise.model');
const ScriptFontModel = require('../models/script.font.model');
const { SCRIPT_FONTS_MANIFEST_KEY } = require('../constants/script-font-redis.constants');
const logger = require('../../../config/lib/logger');

const MANIFEST_TTL_SECONDS = 86400;

exports.invalidateManifest = async function () {
  try {
    await RedisService.deleteData(SCRIPT_FONTS_MANIFEST_KEY);
  } catch (e) {
    logger.warn('script-font manifest invalidate failed', { error: e.message });
  }
};

exports.buildAndCacheManifest = async function () {
  const payload = await ScriptFontModel.loadManifestPayloadFromDb();
  try {
    await RedisService.setData(SCRIPT_FONTS_MANIFEST_KEY, payload, MANIFEST_TTL_SECONDS);
  } catch (e) {
    logger.warn('script-font manifest cache write failed', { error: e.message });
  }
  return payload;
};

exports.getManifestOrNull = async function () {
  try {
    const cached = await RedisService.getData(SCRIPT_FONTS_MANIFEST_KEY);
    if (cached && cached.assetsById) return cached;
  } catch (e) {
    logger.warn('script-font manifest read failed', { error: e.message });
  }
  return null;
};

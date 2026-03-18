'use strict';

const RedisService = require('../../core/models/redis.promise.model');
const TemplateModel = require('../models/template.model');
const logger = require('../../../config/lib/logger');

// TTL for cached template generation meta (in seconds)
const TEMPLATE_META_TTL_SECONDS = 36000; // 10 hrs

function buildTemplateMetaCacheKey(templateId) {
  return `template_generation_meta:${templateId}`;
}

exports.getTemplateGenerationMeta = async function(templateId) {
  const cacheKey = buildTemplateMetaCacheKey(templateId);

  try {
    const cached = await RedisService.getData(cacheKey);
    if (cached) {
      return cached;
    }
  } catch (err) {
    logger.warn('Template meta cache read failed, falling back to DB', { error: err.message, templateId });
  }

  const template = await TemplateModel.getTemplateGenerationMeta(templateId);
  if (!template) {
    return null;
  }

  try {
    await RedisService.setData(cacheKey, template, TEMPLATE_META_TTL_SECONDS);
  } catch (err) {
    logger.warn('Template meta cache write failed', { error: err.message, templateId });
  }

  return template;
};

exports.updateTemplateGenerationMeta = async function(templateId) {
  const cacheKey = buildTemplateMetaCacheKey(templateId);

  // Read from master so we get just-committed data (avoid replication lag writing stale/incomplete template to Redis)
  const template = await TemplateModel.getTemplateGenerationMeta(templateId, { useMaster: true });
  if (!template) {
    // If template doesn't exist, remove from cache
    await RedisService.deleteData(cacheKey);
    return null;
  }

  // Update cache with fresh data
  await RedisService.setData(cacheKey, template, TEMPLATE_META_TTL_SECONDS);
  logger.info('Template generation meta cache updated successfully', { templateId });
  return template;
};

exports.removeTemplateGenerationMeta = async function(templateId) {
  const cacheKey = buildTemplateMetaCacheKey(templateId);
  await RedisService.deleteData(cacheKey);
  logger.info('Template generation meta cache removed successfully', { templateId });
};

exports.removeMultipleTemplateGenerationMeta = async function(templateIds) {
  const cacheKeys = templateIds.map(templateId => buildTemplateMetaCacheKey(templateId));
  await Promise.all(cacheKeys.map(cacheKey => RedisService.deleteData(cacheKey)));
  logger.info('Multiple template generation meta cache removed successfully', { templateIds });
};

// TTL for free max generations cache (4 hours, must match api FreeGenerationLimitService)
const FREE_MAX_TTL_SECONDS = 14400;

/**
 * Sync max_free_generations to Redis when admin updates it
 * Key format: {template_id}:free:max (same as api FreeGenerationLimitService)
 * @param {string} templateId
 * @param {number|null} value - null = use global default, delete Redis key
 */
exports.syncFreeMaxGenerationsRedis = async function(templateId, value) {
  const redisKey = `${templateId}:free:max`;
  try {
    if (value == null) {
      await RedisService.deleteData(redisKey);
      logger.info('[FreeLimit] Redis key deleted on admin update', { templateId, redisKey });
    } else {
      await RedisService.setData(redisKey, value, FREE_MAX_TTL_SECONDS);
      logger.info('[FreeLimit] Redis key updated on admin update', { templateId, value, redisKey });
    }
  } catch (err) {
    logger.error('[FreeLimit] Failed to sync Redis on admin update', { templateId, error: err.message });
    throw err;
  }
};


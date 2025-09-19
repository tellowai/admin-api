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

  // Get fresh data from database
  const template = await TemplateModel.getTemplateGenerationMeta(templateId);
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


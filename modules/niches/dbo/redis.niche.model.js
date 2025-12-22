'use strict';

const RedisService = require('../../core/models/redis.promise.model');
const config = require('../../../config/config');
const logger = require('../../../config/lib/logger');

// Cache TTL in seconds (1 hour)
const CACHE_TTL = 3600;

/**
 * Get niche data from cache
 * @param {string} slug Niche slug
 * @returns {Promise<Object|null>} Niche data or null if not found
 */
exports.getNicheBySlug = async function(slug) {
  const redisKeyName = `niche:slug:${slug}`;
  try {
    const niche = await RedisService.getData(redisKeyName);
    return niche;
  } catch (error) {
    // If key doesn't exist, Redis getData will throw error when trying to parse null
    // This is expected behavior, so we return null
    if (error.message && (error.message.includes('Unexpected token') || 
        error.message.includes('null') || 
        error.message.includes('Cannot read property'))) {
      return null;
    }
    logger.error('Error getting niche from Redis:', { error: error.message, slug });
    return null;
  }
};

/**
 * Store niche data in cache
 * @param {string} slug Niche slug
 * @param {Object} nicheData Niche data to store
 * @returns {Promise<void>}
 */
exports.setNicheBySlug = async function(slug, nicheData) {
  const redisKeyName = `niche:slug:${slug}`;
  try {
    return await RedisService.setData(redisKeyName, nicheData, CACHE_TTL);
  } catch (error) {
    logger.error('Error setting niche in Redis:', { error: error.message, slug });
    throw error;
  }
};

/**
 * Get field definitions for a niche from cache
 * @param {number} nicheId Niche ID
 * @returns {Promise<Array|null>} Field definitions array or null if not found
 */
exports.getFieldDefinitionsByNicheId = async function(nicheId) {
  const redisKeyName = `niche:field_definitions:${nicheId}`;
  try {
    const fieldDefinitions = await RedisService.getData(redisKeyName);
    return fieldDefinitions;
  } catch (error) {
    // If key doesn't exist, Redis getData will throw error when trying to parse null
    // This is expected behavior, so we return null
    if (error.message && (error.message.includes('Unexpected token') || 
        error.message.includes('null') || 
        error.message.includes('Cannot read property'))) {
      return null;
    }
    logger.error('Error getting field definitions from Redis:', { error: error.message, nicheId });
    return null;
  }
};

/**
 * Store field definitions for a niche in cache
 * @param {number} nicheId Niche ID
 * @param {Array} fieldDefinitions Field definitions array to store
 * @returns {Promise<void>}
 */
exports.setFieldDefinitionsByNicheId = async function(nicheId, fieldDefinitions) {
  const redisKeyName = `niche:field_definitions:${nicheId}`;
  try {
    return await RedisService.setData(redisKeyName, fieldDefinitions, CACHE_TTL);
  } catch (error) {
    logger.error('Error setting field definitions in Redis:', { error: error.message, nicheId });
    throw error;
  }
};

/**
 * Invalidate niche cache (delete from Redis)
 * @param {string} slug Niche slug
 * @returns {Promise<void>}
 */
exports.invalidateNicheCache = async function(slug) {
  const redisKeyName = `niche:slug:${slug}`;
  try {
    return await RedisService.deleteData(redisKeyName);
  } catch (error) {
    logger.error('Error invalidating niche cache:', { error: error.message, slug });
    // Don't throw, just log
  }
};

/**
 * Invalidate field definitions cache (delete from Redis)
 * @param {number} nicheId Niche ID
 * @returns {Promise<void>}
 */
exports.invalidateFieldDefinitionsCache = async function(nicheId) {
  const redisKeyName = `niche:field_definitions:${nicheId}`;
  try {
    return await RedisService.deleteData(redisKeyName);
  } catch (error) {
    logger.error('Error invalidating field definitions cache:', { error: error.message, nicheId });
    // Don't throw, just log
  }
};


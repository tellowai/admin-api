'use strict';

const RedisService = require('./redis.promise.model');
const config = require('../../../config/config');
const logger = require('../../../config/lib/logger');

/**
 * Get timer for mobile connection OTP
 * @param {string} mobile Mobile number
 * @param {string} clientId Client identifier
 * @returns {Promise<boolean>} True if timer exists, false otherwise
 */
exports.getTimerForMobileConnectionOTP = async function(mobile, clientId) {
  const redisKeyName = `mobile_connection_otp_timer:${mobile}:${clientId}`;
  const timer = await RedisService.getData(redisKeyName);
  return !!timer;
};

/**
 * Set timer for mobile connection OTP
 * @param {string} mobile Mobile number
 * @param {string} clientId Client identifier
 * @returns {Promise<void>}
 */
exports.setTimerForMobileConnectionOTP = async function(mobile, clientId) {
  const redisKeyName = `mobile_connection_otp_timer:${mobile}:${clientId}`;
  return await RedisService.setData(redisKeyName, '1', config.otp.resendExpiresInSeconds);
};

/**
 * Store mobile connection OTP in cache
 * @param {string} mobile Mobile number
 * @param {string} clientId Client identifier
 * @param {Object} otpData OTP data to store
 * @returns {Promise<void>}
 */
exports.storeMobileConnectionOTP = async function(mobile, clientId, otpData) {
  const redisKeyName = `mobile_connection_otp:${mobile}:${clientId}`;
  return await RedisService.setData(redisKeyName, otpData, config.otp.expiresInSeconds);
};

/**
 * Get mobile connection OTP from cache
 * @param {string} mobile Mobile number
 * @param {string} clientId Client identifier
 * @returns {Promise<Object|null>} OTP data or null if not found
 */
exports.getMobileConnectionOTP = async function(mobile, clientId) {
  const redisKeyName = `mobile_connection_otp:${mobile}:${clientId}`;
  return await RedisService.getData(redisKeyName);
};

/**
 * Delete mobile connection OTP from cache
 * @param {string} mobile Mobile number
 * @param {string} clientId Client identifier
 * @returns {Promise<void>}
 */
exports.deleteMobileConnectionOTP = async function(mobile, clientId) {
  const redisKeyName = `mobile_connection_otp:${mobile}:${clientId}`;
  logger.debug('Redis key for mobile connection OTP:', { redisKeyName });
  return await RedisService.deleteData(redisKeyName);
};
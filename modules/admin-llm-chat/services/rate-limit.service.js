'use strict';

const CONSTANTS = require('../constants/admin-llm-chat.constants');
const ERROR_CODES = require('../constants/error.codes');

async function checkUserRpm(userId, action, limitPerMin) {
  if (!limitPerMin || limitPerMin <= 0) return true;
  try {
    const { redisClient } = require('../../../config/lib/redis');
    if (!redisClient?.isReady) return true;
    const key = `${CONSTANTS.REDIS_PREFIX}:rpm:${action}:${userId}:${Math.floor(Date.now() / 60000)}`;
    const count = await redisClient.incr(key);
    if (count === 1) await redisClient.expire(key, 90);
    return count <= limitPerMin;
  } catch (_e) {
    return true;
  }
}

async function assertUserRpm(userId, action, limitPerMin) {
  const ok = await checkUserRpm(userId, action, limitPerMin);
  if (!ok) {
    const err = ERROR_CODES.PROVIDER_RATELIMIT || {
      code: 'PROVIDER_RATELIMIT',
      httpStatus: 429,
      retryable: true,
    };
    const e = new Error(err.message || 'Rate limit exceeded');
    e.code = err.code;
    e.httpStatus = err.httpStatus || 429;
    e.retryable = err.retryable !== false;
    throw e;
  }
}

module.exports = { checkUserRpm, assertUserRpm };

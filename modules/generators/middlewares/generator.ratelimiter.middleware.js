'use strict';

const RATE_LIMITS = require('../../core/constants/rate-limits.constants').limits;
const RateLimiterCoreCtrl = require('../../core/controllers/rate-limiter.core.controller');
const i18next = require('i18next');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const logger = require('../../../config/lib/logger');

/**
 * Check if user has exceeded generation rate limits
 */
const isGenerationRateLimited = async (req, res, next) => {
  const userId = req.user.userId;
  const actionName = 'generate_images';
  const GENERATION_LIMITS = RATE_LIMITS.GENERATE_IMAGES;

  try {
    await RateLimiterCoreCtrl.verifyRateLimit(
      userId,
      actionName,
      GENERATION_LIMITS
    );

    return next();
  } catch (err) {
    if (err.customErrCode) {
      res.setHeader('X-PB-ERROR-CODE', err.customErrCode);
    }

    return res.status(err.httpStatusCode || HTTP_STATUS_CODES.TOO_MANY_REQUESTS)
      .json({
        message: err.message || i18next.t('generator:GENERATION_RATE_LIMIT_EXCEEDED')
      });
  }
};

/**
 * Store generation action for rate limiting
 */
const storeGenerationAction = async (userId) => {
  const actionName = 'generate_images';

  await RateLimiterCoreCtrl.storeActionState(
    userId,
    actionName
  );

  return true;
};

module.exports = {
  isGenerationRateLimited,
  storeGenerationAction
}; 
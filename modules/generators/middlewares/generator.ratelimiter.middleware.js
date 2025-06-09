'use strict';

const RATE_LIMITS = require('../../core/constants/rate-limits.constants').limits;
const RateLimiterCoreCtrl = require('../../core/controllers/rate-limiter.core.controller');
const RateLimiterCtrl = require('../../rate-limiter/controllers/ratelimiter.controller');
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
 * Check if user has exceeded video flow composer generation rate limits
 */
const isVideoFlowComposerRateLimited = async (req, res, next) => {
  const userId = req.user.userId;
  const actionName = 'generate_video_flow_composer';
  const GENERATION_LIMITS = RATE_LIMITS.GENERATE_VIDEO_FLOW_COMPOSER;

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

  await RateLimiterCtrl.storeActionState(
    userId,
    actionName
  );

  return true;
};

/**
 * Store video flow composer generation action for rate limiting
 */
const storeVideoFlowComposerAction = async (userId) => {
  const actionName = 'generate_video_flow_composer';

  await RateLimiterCtrl.storeActionState(
    userId,
    actionName
  );

  return true;
};

module.exports = {
  isGenerationRateLimited,
  isVideoFlowComposerRateLimited,
  storeGenerationAction,
  storeVideoFlowComposerAction
}; 
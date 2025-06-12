'use strict';

const RATE_LIMITS = require('../../core/constants/rate-limits.constants').limits;
const RateLimiterCoreCtrl = require('../../core/controllers/rate-limiter.core.controller');
const RateLimiter = require('../../rate-limiter/controllers/ratelimiter.controller');
const i18next = require('i18next');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

/**
 * Check if user has exceeded video merge rate limits
 */
const isVideoMergeRateLimited = async (req, res, next) => {
  const userId = req.user.userId;
  const actionName = 'merge_videos';
  const MERGE_LIMITS = RATE_LIMITS.MERGE_VIDEOS;

  try {
    await RateLimiterCoreCtrl.verifyRateLimit(
      userId,
      actionName,
      MERGE_LIMITS
    );

    return next();
  } catch (err) {
    if (err.customErrCode) {
      res.setHeader('X-PB-ERROR-CODE', err.customErrCode);
    }

    return res.status(err.httpStatusCode || HTTP_STATUS_CODES.RATE_LIMITED)
      .json({
        message: err.message || i18next.t('video_editing:VIDEO_MERGE_RATE_LIMIT_EXCEEDED')
      });
  }
};

/**
 * Store video merge action for rate limiting
 */
const storeVideoMergeAction = async (userId) => {
  const actionName = 'merge_videos';
  await RateLimiter.storeActionState(userId, actionName);
  return true;
};

module.exports = {
  isVideoMergeRateLimited,
  storeVideoMergeAction
}; 
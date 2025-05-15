'use strict';

const RATE_LIMITS = require('../../core/constants/rate-limits.constants').limits;
const RateLimiterCoreCtrl = require('../../core/controllers/rate-limiter.core.controller');
const RateLimiter = require('../../rate-limiter/controllers/ratelimiter.controller');
const i18next = require('i18next');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;

const isPhotoModelTuningRateLimited = async (req, res, next) => {
  const userId = req.user.userId;
  const actionName = 'photo_model_tuning';
  const TUNING_LIMITS = RATE_LIMITS.PHOTO_MODEL_TUNING;

  try {
    await RateLimiterCoreCtrl.verifyRateLimit(
      userId,
      actionName,
      TUNING_LIMITS
    );

    return next();
  } catch (err) {
    if (err.customErrCode) {
      res.setHeader('X-PB-ERROR-CODE', err.customErrCode);
    }

    return res.status(err.httpStatusCode || HTTP_STATUS_CODES.RATE_LIMITED)
      .json({
        message: err.message || i18next.t('generator:TUNING_RATE_LIMIT_EXCEEDED')
      });
  }
};

const storePhotoModelTuningAction = async (userId) => {
  const actionName = 'photo_model_tuning';
  await RateLimiter.storeActionState(userId, actionName);
  return true;
};

module.exports = {
  isPhotoModelTuningRateLimited,
  storePhotoModelTuningAction
}; 
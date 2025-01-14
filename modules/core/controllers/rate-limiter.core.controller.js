const i18next = require('i18next');
const RateLimiterCtrl = require('../../rate-limiter/controllers/ratelimiter.controller');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const CUSTOM_ERROR_CODES = require('../../core/controllers/customerrorcodes.server.controller').CODES;


const verifyRateLimit = async (userId, actionName, LIMITS) => {
  try {
    const checkResourceActionCount = async (timeWindow) => {
      const actionCount = await RateLimiterCtrl.getActionCountInWindow(
        userId,
        actionName,
        timeWindow
      );

      return actionCount;
    };

    const checkLimitExceeded = (actionCount, limit, errorCode, errorMessageKey) => {
      if (limit && actionCount >= limit) {
        throw {
          customErrCode: errorCode,
          httpStatusCode: HTTP_STATUS_CODES.RATE_LIMITED,
          message: i18next.t(`ratelimiter:${errorMessageKey}`)
        };
      }
    };

    const { DAILY, HOURLY, MINUTE } = LIMITS;

    const noOfActionsInDailyWindow = await checkResourceActionCount('DAILY');
    checkLimitExceeded(noOfActionsInDailyWindow, DAILY, CUSTOM_ERROR_CODES.DAILY_THRESHOLD_HIT, 'DAILY_LIMIT_HIT');

    if (HOURLY) {
      const noOfActionsInHourlyWindow = await checkResourceActionCount('HOURLY');
      checkLimitExceeded(noOfActionsInHourlyWindow, HOURLY, CUSTOM_ERROR_CODES.DAILY_THRESHOLD_HIT, 'HOURLY_LIMIT_HIT');
    }

    if (MINUTE) {
      const noOfActionsInMinuteWindow = await checkResourceActionCount('MINUTE');
      checkLimitExceeded(noOfActionsInMinuteWindow, MINUTE, CUSTOM_ERROR_CODES.DAILY_THRESHOLD_HIT, 'MINUTE_LIMIT_HIT');
    }

    return null;
  } catch (err) {
    throw {
      customErrCode: err.customErrCode,
      httpStatusCode: err.httpStatusCode || HTTP_STATUS_CODES.BAD_REQUEST,
      message: err.message || i18next.t('common:SOMETHING_WENT_WRONG_PLEASE_TRY_AGAIN')
    };
  }
};

module.exports = {
  verifyRateLimit
};

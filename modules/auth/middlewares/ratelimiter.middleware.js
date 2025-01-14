const RATE_LIMITS = require('../constants/rate.limit.constants').limits;
const RateLimiterCoreCtrl = require('../../core/controllers/rate-limiter.core.controller');
const RateLimiter = require('../../rate-limiter/controllers/ratelimiter.controller');
const i18next = require('i18next');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;


const isAllowedToSendOTP = async (req, res, next) => {
  const payload = req.validatedBody;
  const userId = payload.contact_value;
  const actionName = 'send_otp';
  const LOGIN_OTP_LIMITS = RATE_LIMITS.LOGIN_OTP;

  try {
    await RateLimiterCoreCtrl.verifyRateLimit(
      userId,
      actionName,
      LOGIN_OTP_LIMITS
    );

    return next(null);
  } catch (err) {
    if (err.customErrCode) {
      res.setHeader('X-BC-ERROR-CODE', err.customErrCode);
    }

    return res.status(err.httpStatusCode || HTTP_STATUS_CODES.BAD_REQUEST)
      .json({
        message: err.message || i18next.t('common:SOMETHING_WENT_WRONG_PLEASE_TRY_AGAIN')
      })
  };
};

const storeSendLoginOTPAction = async (contactValue) => {
  const userId = contactValue;
  const actionName = 'send_otp';

  RateLimiter.storeActionState(
    userId,
    actionName
  );

  return 1;
};


module.exports = {
  isAllowedToSendOTP,
  storeSendLoginOTPAction,
};

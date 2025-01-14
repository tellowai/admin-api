const i18next = require('i18next');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const ErrorResponseHandler = require('../../core/middlewares/core.error.handler.middleware');


exports.handleFetchAllLogsErrors = function (err, res) {
  if (err.customErrCode) {
    ErrorResponseHandler.setCustomErrorHeader(err.customErrCode, res);
  }

  return ErrorResponseHandler.sendErrorResponse(
    err.httpStatusCode || err.custom.httpStatusCode,
    err.message || err.custom.message,
    res
  );
}

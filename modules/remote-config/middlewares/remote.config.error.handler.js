const i18next = require('i18next');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const ErrorResponseHandler = require('../../core/middlewares/core.error.handler.middleware');


exports.handleNewAdminCreationErrors = function (err, res) {
  if (err.customErrCode) {
    ErrorResponseHandler.setCustomErrorHeader(err.customErrCode, res);
  }

  if(err && err.customErrCode === 'ORIGINAL_RESOURCE_DOESNOT_EXISTS' && err.originalMessage.includes('role_id')) {

    return ErrorResponseHandler.sendErrorResponse(
      HTTP_STATUS_CODES.NOT_FOUND || err.httpStatusCode || err.custom.httpStatusCode,
      i18next.t('user:REQUESTED_ROLE_DOES_NOT_EXSIT'),
      res
    );
  } else if(err && err.customErrCode === 'ORIGINAL_RESOURCE_DOESNOT_EXISTS' && err.originalMessage.includes('user_id')) {

    return ErrorResponseHandler.sendErrorResponse(
      HTTP_STATUS_CODES.NOT_FOUND || err.httpStatusCode || err.custom.httpStatusCode,
      i18next.t('user:REQUESTED_USER_DOES_NOT_EXSIT'),
      res
    );
  }

  return ErrorResponseHandler.sendErrorResponse(
    err.httpStatusCode || err.custom.httpStatusCode,
    err.message || err.custom.message,
    res
  );
}

exports.handleNewAdminDeletionErrors = function (err, res) {
  if (err.customErrCode) {
    ErrorResponseHandler.setCustomErrorHeader(err.customErrCode, res);
  }

  if(err && err.customErrCode === 'ORIGINAL_RESOURCE_DOESNOT_EXISTS' && err.originalMessage.includes('user_id')) {

    return ErrorResponseHandler.sendErrorResponse(
      HTTP_STATUS_CODES.NOT_FOUND || err.httpStatusCode || err.custom.httpStatusCode,
      i18next.t('user:REQUESTED_USER_DOES_NOT_EXSIT'),
      res
    );
  }

  return ErrorResponseHandler.sendErrorResponse(
    err.httpStatusCode || err.custom.httpStatusCode,
    err.message || err.custom.message,
    res
  );
}

exports.handleConfigConditionFetchErrors = function (err, res) {
  if (err.customErrCode) {
    ErrorResponseHandler.setCustomErrorHeader(err.customErrCode, res);
  }

  return ErrorResponseHandler.sendErrorResponse(
    err.httpStatusCode || err.custom.httpStatusCode,
    err.message || err.custom.message,
    res
  );
}

exports.handleNewRemoteConfigCreationErrors = function (err, res) {
  if (err.customErrCode) {
    ErrorResponseHandler.setCustomErrorHeader(err.customErrCode, res);
  }

  return ErrorResponseHandler.sendErrorResponse(
    err.httpStatusCode || err.custom.httpStatusCode,
    err.message || err.custom.message,
    res
  );
}

exports.handleRemoteConfigValuesFetchErrors = function (err, res) {
  if (err.customErrCode) {
    ErrorResponseHandler.setCustomErrorHeader(err.customErrCode, res);
  }

  return ErrorResponseHandler.sendErrorResponse(
    err.httpStatusCode || err.custom.httpStatusCode,
    err.message || err.custom.message,
    res
  );
}

exports.handleRemoteConfigValuesUpdateErrors = function (err, res) {
  if (err.customErrCode) {
    ErrorResponseHandler.setCustomErrorHeader(err.customErrCode, res);
  }

  return ErrorResponseHandler.sendErrorResponse(
    err.httpStatusCode || err.custom.httpStatusCode,
    err.message || err.custom.message,
    res
  );
}

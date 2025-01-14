
exports.setCustomErrorHeader = function(customErrCode, res) {
  res.setHeader('X-BC-ERROR-CODE', customErrCode);
}

exports.sendErrorResponse = function(httpStatusCode, errorMessage, res) {

  return res.status(httpStatusCode).json({
    message: errorMessage
  });
}

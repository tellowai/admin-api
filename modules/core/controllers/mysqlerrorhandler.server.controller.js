var i18next = require("i18next");

var HTTP_STATUS_CODES =
  require("./httpcodes.server.controller").CODES;
var CUSTOM_ERROR_CODES =
require("./customerrorcodes.server.controller").CODES;


exports.handleMysqlConnErrors = function (connErrOb) {

    if(connErrOb.code == 'ER_ACCESS_DENIED_ERROR' ||  connErrOb.errno == '1045') {

        var errMsg = i18next.t("mysql:USERNAME_OR_PWD_DENIED");

        return {
            message: errMsg,
            httpStatusCode: HTTP_STATUS_CODES.UNAUTHORIZED,
            customErrCode: CUSTOM_ERROR_CODES.DB_ACCESS_DENIED
        };
    } else if(connErrOb.code == 'ECONNREFUSED' ||  connErrOb.errno == '-61') {

        var errMsg = i18next.t("mysql:DB_CONNECTION_REFUSED");

        return {
            message: errMsg,
            httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
            customErrCode: CUSTOM_ERROR_CODES.DB_CONN_REFUSED
        };
    }

    var errMsg = i18next.t("mysql:CONNECTION_ERROR_PLEASE_TRY_AGAIN");

    return {
        message: errMsg,
        httpStatusCode: HTTP_STATUS_CODES.SERVICE_UNAVAILABLE,
        customErrCode: CUSTOM_ERROR_CODES.DB_CONNECTION_ERROR
    };
}

exports.handleMysqlQueryErrors = function (queryErrOb) {
    if(queryErrOb.code == 'ER_NO_SUCH_TABLE' ||  queryErrOb.errno == '1146') {

        var errMsg = i18next.t("mysql:TABLE_DOESNOT_EXIST");

        return {
            message: errMsg,
            originalMessage: queryErrOb.sqlMessage,
            httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
            customErrCode: CUSTOM_ERROR_CODES.TABLE_DOESNOT_EXIST
        };
    } else if(queryErrOb.code == 'ER_BAD_FIELD_ERROR' ||  queryErrOb.errno == '1054') {

        var errMsg = i18next.t("mysql:TABLE_COLUMN_DOESNOT_EXIST");

        return {
            message: errMsg,
            originalMessage: queryErrOb.sqlMessage,
            httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
            customErrCode: CUSTOM_ERROR_CODES.TABLE_COLUMN_DOESNOT_EXIST
        };
    } else if(queryErrOb.code == 'ER_DUP_ENTRY' ||  queryErrOb.errno == '1062') {

        var errMsg = i18next.t("mysql:DUPLICATE_ENTRY");

        return {
            message: errMsg,
            originalMessage: queryErrOb.sqlMessage,
            httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
            customErrCode: CUSTOM_ERROR_CODES.RESOURCE_EXISTS
        };
    } else if(queryErrOb.code == 'ER_NO_REFERENCED_ROW_2' ||  queryErrOb.errno == '1452') {

        var errMsg = i18next.t("mysql:ORIGINAL_RESOURCE_DOES_NOT_EXIST");

        return {
            message: errMsg,
            originalMessage: queryErrOb.sqlMessage,
            httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
            customErrCode: CUSTOM_ERROR_CODES.ORIGINAL_RESOURCE_DOES_NOT_EXIST
        };
    }  else if(queryErrOb.code == 'ER_BAD_NULL_ERROR' ||  queryErrOb.errno == '1048') {

        var errMsg = i18next.t("mysql:TABLE_COLUMN_CANNOT_BE_NULL");

        return {
            message: errMsg,
            originalMessage: queryErrOb.sqlMessage,
            httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
            customErrCode: CUSTOM_ERROR_CODES.TABLE_COLUMN_CANNOT_BE_NULL
        };
    }

    var errMsg = i18next.t("mysql:QUERY_ERROR_PLEASE_TRY_AGAIN");

    return {
        message: errMsg,
        httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
        customErrCode: CUSTOM_ERROR_CODES.DB_QUERY_ERROR
    };
}

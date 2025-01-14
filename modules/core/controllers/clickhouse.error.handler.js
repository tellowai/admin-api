'use strict';

var i18next = require("i18next");

var HTTP_STATUS_CODES = require("./httpcodes.server.controller").CODES;
var CUSTOM_ERROR_CODES = require("./customerrorcodes.server.controller").CODES;

exports.handleClickHouseConnErrors = function (connErrOb) {
    // Assuming connErrOb can have a structure like { code: Number, message: String }
    // ClickHouse error handling
    if (connErrOb.code === 401) {
        var errMsg = i18next.t("clickhouse:USERNAME_OR_PWD_DENIED");

        return {
            message: errMsg,
            httpStatusCode: HTTP_STATUS_CODES.UNAUTHORIZED,
            customErrCode: CUSTOM_ERROR_CODES.DB_ACCESS_DENIED
        };
    } else if (connErrOb.code === 503) {
        var errMsg = i18next.t("clickhouse:SERVICE_UNAVAILABLE");

        return {
            message: errMsg,
            httpStatusCode: HTTP_STATUS_CODES.SERVICE_UNAVAILABLE,
            customErrCode: CUSTOM_ERROR_CODES.DB_CONN_REFUSED
        };
    }

    var errMsg = i18next.t("clickhouse:CONNECTION_ERROR_PLEASE_TRY_AGAIN");

    return {
        message: errMsg,
        httpStatusCode: HTTP_STATUS_CODES.SERVICE_UNAVAILABLE,
        customErrCode: CUSTOM_ERROR_CODES.DB_CONNECTION_ERROR
    };
};

exports.handleClickHouseQueryErrors = function (queryErrOb) {
    const errorMessage = queryErrOb.toString();

    if (errorMessage.includes('UNKNOWN_TABLE')) {
        var errMsg = i18next.t("clickhouse:TABLE_DOESNOT_EXIST");

        return {
            message: errMsg,
            originalMessage: queryErrOb.message,
            customErrCode: CUSTOM_ERROR_CODES.TABLE_DOESNOT_EXIST
        };
    } else if (errorMessage.includes('UNKNOWN_COLUMN')) {
        var errMsg = i18next.t("clickhouse:TABLE_COLUMN_DOESNOT_EXIST");

        return {
            message: errMsg,
            originalMessage: queryErrOb.message,
            customErrCode: CUSTOM_ERROR_CODES.TABLE_COLUMN_DOESNOT_EXIST
        };
    }

    var errMsg = i18next.t("clickhouse:QUERY_ERROR_PLEASE_TRY_AGAIN");

    return {
        message: errMsg,
        originalMessage: queryErrOb.message,
        customErrCode: CUSTOM_ERROR_CODES.DB_QUERY_ERROR
    };
};

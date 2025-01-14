var neo4jDriver = require("../../../config/lib/neo4j").neo4jDriver;
var config = require('../../../config/config');
var HTTP_STATUS_CODES =
  require("../../core/controllers/httpcodes.server.controller").CODES;
var CUSTOM_ERROR_CODES =
require("../../core/controllers/customerrorcodes.server.controller").CODES;
var neo4jErrorHandler = require('../../core/controllers/neo4jerrorhandler.server.controller');

var i18next = require("i18next");
var _ = require("lodash");
var chalk = require("chalk");


exports.runNeo4jQuery = function (query, data, next) {

    const neo4jMasterSessionConn = neo4jDriver.session({
        database: config.neo4j.master.databaseName
    });

    neo4jMasterSessionConn.run(query, data).then(result => {
        
        neo4jMasterSessionConn.close();

        return next(null, result.records);
    })
    .catch(error => {

        if (error) {

            console.error(chalk.red(error));
            
            neo4jMasterSessionConn.close();
            
            var finalErrObj = neo4jErrorHandler.handleNeo4jQueryErrors(error);

            return next(finalErrObj);
        }

        var responsePayload = {
            message: i18next.t("neo4j:QUERY_ERROR_PLEASE_TRY_AGAIN"),
            httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
            customErrCode: CUSTOM_ERROR_CODES.DB_QUERY_ERROR
        };
        
        neo4jMasterSessionConn.close();

        return next(responsePayload);
    })
    .then(() => {});
};
  
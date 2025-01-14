const chalk = require('chalk');
const { masterClickhouse, slaveClickhouse } = require('../../../config/lib/clickhouse');
var clickHouseErrorHandler = require('../../core/controllers/clickhouse.error.handler');

exports.runQueryInMaster = function(query, data) {
    return new Promise((resolve, reject) => {
        const stream = masterClickhouse.query(query, data, function(err, result) {
            if (err) {
                console.error(chalk.red(err));
                var finalErrObj = clickHouseErrorHandler.handleClickHouseQueryErrors(err);
                reject(finalErrObj);
            } else {
                // console.log("Full result object:", result); // Log the full result object to inspect its structure

                resolve(result);
            }
        });
    });
};

exports.runQueryInSlave = function(query, data) {
    return new Promise((resolve, reject) => {
        const stream = slaveClickhouse.query(query, data, function(err, result) {
            if (err) {
                console.error(chalk.red(err));
                var finalErrObj = clickHouseErrorHandler.handleClickHouseQueryErrors(err);
                reject(finalErrObj);
            } else {
                resolve(result);
            }
        });
    });
};

exports.runQueryingInMaster = async function(query, data) {
        const { data:responsedata } = await masterClickhouse.querying(query, { dataObjects: true })

        return responsedata;
};

exports.runQueryingInSlave = async function(query, data) {
    const { data:responsedata } = await slaveClickhouse.querying(query, { dataObjects: true })

    return responsedata;
};

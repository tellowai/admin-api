var masterConnection = require("../../../config/lib/mysql").masterConn;
var slaveConnection = require("../../../config/lib/mysql").slaveConn;
var mysqlErrorHandler = require('../controllers/mysqlerrorhandler.server.controller');

var _ = require("lodash");
var chalk = require("chalk");


exports.runQueryInMaster = function (query, data, next) {

    masterConnection.getConnection(function (connErr, connection) {

        if (connErr) {
            
          console.error(chalk.red(connErr));
    
          var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);
    
          if(connection) {
            
            connection.release();
          }
    
          return next(finalErrObj);
        }
    
        connection.query(
            query, data, function (err, rows) {
    
            if (err) {
    
              console.error(chalk.red(err));
              connection.release();
              
              var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);
    
              return next(finalErrObj);
            }
    
            connection.release();
    
            return next(null, rows);
          }
        );
    });
};

exports.runQueryInSlave = function (query, data, next) {

    slaveConnection.getConnection(function (connErr, connection) {

        if (connErr) {
            
          console.error(chalk.red(connErr));
    
          var finalErrObj = mysqlErrorHandler.handleMysqlConnErrors(connErr);
    
          if(connection) {
            
            connection.release();
          }
    
          return next(finalErrObj);
        }
    
        connection.query(
            query, data, function (err, rows) {
    
            if (err) {
    
              console.error(chalk.red(err));
              connection.release();
              
              var finalErrObj = mysqlErrorHandler.handleMysqlQueryErrors(err);
    
              return next(finalErrObj);
            }
    
            connection.release();
    
            return next(null, rows);
          }
        );
    });
};

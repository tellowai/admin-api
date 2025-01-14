'use strict';

/**
 * Module dependencies.
 */
var config = require('../config'),
  mysql = require('mysql2');

var masterConnConfig = {
  connectionLimit : 3,
  host : config.mysql.master.url,
  port: config.mysql.master.port,
  user : config.mysql.master.options.user,
  password : config.mysql.master.options.pass,
  database : config.mysql.master.databaseName,
  charset: 'utf8mb4'
};

var slaveConnConfig = {
  connectionLimit : 3,
  host : config.mysql.slave.url,
  port: config.mysql.slave.port,
  user : config.mysql.slave.options.user,
  password : config.mysql.slave.options.pass,
  database : config.mysql.slave.databaseName,
  charset: 'utf8mb4'
};

var masterConnPool = mysql.createPool(masterConnConfig);
var slaveConnPool = mysql.createPool(slaveConnConfig);

module.exports.masterConn = masterConnPool;
module.exports.slaveConn = slaveConnPool;

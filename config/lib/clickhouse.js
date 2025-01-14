'use strict';

const config = require('../config');
const ClickHouse = require('@apla/clickhouse');


const masterOptions = {
  host: config.clickhouse.master.url,
  port: config.clickhouse.master.port,
  user: config.clickhouse.master.user,
  password: config.clickhouse.master.password,
  queryOptions: {
    database: config.clickhouse.master.databaseName,
  },
};

const slaveOptions = {
  host: config.clickhouse.slave.url,
  port: config.clickhouse.slave.port,
  user: config.clickhouse.slave.user,
  password: config.clickhouse.slave.password,
  queryOptions: {
    database: config.clickhouse.slave.databaseName,
  },
};


const masterClickhouseClient = new ClickHouse(masterOptions);
const slaveClickhouseClient = new ClickHouse(slaveOptions);

module.exports.masterClickhouse = masterClickhouseClient;
module.exports.slaveClickhouse = slaveClickhouseClient;

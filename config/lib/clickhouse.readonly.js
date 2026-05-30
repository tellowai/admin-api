'use strict';

const config = require('../config');
const ClickHouse = require('@apla/clickhouse');

// ONLY the dedicated read-only user — never fall back to slave/master (write-capable).
const chConfig = config.clickhouse?.adminLlmChatReadonly || {};

const options = {
  host: chConfig.url,
  port: chConfig.port,
  user: chConfig.user,
  password: chConfig.password,
  queryOptions: {
    database: chConfig.databaseName,
    max_execution_time: 30,
    max_result_rows: 100000,
    readonly: 2,
  },
};

module.exports.readonlyClickhouse = new ClickHouse(options);

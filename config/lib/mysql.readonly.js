'use strict';

/**
 * Dedicated read-only MySQL pool for the admin LLM chat.
 * Uses ONLY config.mysql.adminLlmChatReadonly — never the slave/master creds,
 * which have write access. Configure a read-only MySQL user in env/local.js.
 */
const config = require('../config');
const mysql = require('mysql2');

const roConfig = config.mysql?.adminLlmChatReadonly || {};

const options = {
  connectionLimit: 3,
  host: roConfig.url,
  port: roConfig.port,
  user: roConfig.options?.user,
  password: roConfig.options?.pass,
  database: roConfig.databaseName,
  charset: 'utf8mb4',
};

const readonlyMysqlPool = mysql.createPool(options);

module.exports.readonlyMysql = readonlyMysqlPool;
module.exports.readonlyMysqlDatabase = roConfig.databaseName || '';

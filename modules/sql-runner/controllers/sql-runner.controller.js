'use strict';

const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const SqlRunnerService = require('../services/sql-runner.service');

exports.listDatabases = async function listDatabases(req, res) {
  try {
    const { engine } = req.validatedQuery;
    const result = await SqlRunnerService.listDatabases(engine);

    if (!result.success) {
      return res.status(HTTP_CODES.BAD_REQUEST).json({
        message: result.message,
        error: result.error,
      });
    }

    return res.status(HTTP_CODES.OK).json({
      databases: result.databases,
      default: result.default,
    });
  } catch (error) {
    return res.status(HTTP_CODES.INTERNAL_SERVER_ERROR).json({
      message: error.message || 'Failed to list databases',
    });
  }
};

exports.runQuery = async function runQuery(req, res) {
  try {
    const { engine, database, sql, limit, offset } = req.validatedBody;
    const result = await SqlRunnerService.runQuery({
      engine,
      database,
      sql,
      limit,
      offset,
    });

    if (!result.success) {
      return res.status(HTTP_CODES.BAD_REQUEST).json({
        message: result.message,
        error: result.error,
      });
    }

    return res.status(HTTP_CODES.OK).json({
      rows: result.rows,
      columns: result.columns,
      rowCount: result.rowCount,
      totalCount: result.totalCount,
      totalCountCapped: result.totalCountCapped,
      limit: result.limit,
      offset: result.offset,
      hasMore: result.hasMore,
      queryMs: result.queryMs,
    });
  } catch (error) {
    return res.status(HTTP_CODES.INTERNAL_SERVER_ERROR).json({
      message: error.message || 'Failed to run query',
    });
  }
};

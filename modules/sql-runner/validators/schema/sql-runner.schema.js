'use strict';

const Joi = require('@hapi/joi');
const CONSTANTS = require('../../constants/sql-runner.constants');

module.exports = {
  listDatabasesSchema: Joi.object({
    engine: Joi.string().valid(...CONSTANTS.ENGINES).required(),
  }),

  runQuerySchema: Joi.object({
    engine: Joi.string().valid(...CONSTANTS.ENGINES).required(),
    database: Joi.string().pattern(CONSTANTS.DATABASE_NAME_REGEX).required(),
    sql: Joi.string().min(1).max(50000).required(),
    limit: Joi.number().integer().min(1).max(CONSTANTS.MAX_LIMIT).optional(),
    offset: Joi.number().integer().min(0).optional(),
  }),
};

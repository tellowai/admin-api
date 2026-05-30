'use strict';

const Joi = require('@hapi/joi');
const CONSTANTS = require('../../constants/sql-runner.constants');

module.exports = {
  runQuerySchema: Joi.object({
    engine: Joi.string().valid(...CONSTANTS.ENGINES).required(),
    sql: Joi.string().min(1).max(50000).required(),
    limit: Joi.number().integer().min(1).max(CONSTANTS.MAX_LIMIT).optional(),
    offset: Joi.number().integer().min(0).optional(),
  }),
};

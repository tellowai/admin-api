'use strict';

const Joi = require('@hapi/joi');

const unitEconomicsSchema = Joi.object().keys({
  start_date: Joi.date().iso().required(),
  end_date: Joi.date().iso().min(Joi.ref('start_date')).required(),
  tz: Joi.string().optional().allow('')
});

exports.unitEconomicsSchema = unitEconomicsSchema;

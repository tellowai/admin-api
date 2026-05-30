'use strict';

const Joi = require('@hapi/joi');
const { defineWidget } = require('./widget.contract');

module.exports = defineWidget({
  type: 'kpi_cards',
  version: 1,
  title: 'KPI cards',
  library: 'markup',
  description:
    'Row of metric cards with label, value, and optional delta %. Use for 2–6 headline numbers (revenue, orders, ROAS).',
  aliases: ['kpi', 'metrics', 'summary cards', 'headline numbers'],
  exportable: false,
  dataSchema: Joi.object({
    title: Joi.string().max(200).allow(''),
    cards: Joi.array().items(
      Joi.object({
        label: Joi.string().max(120).required(),
        value: Joi.alternatives().try(Joi.string().max(80), Joi.number()).required(),
        delta: Joi.string().max(40).allow('', null),
        deltaDirection: Joi.string().valid('up', 'down', 'neutral').allow(null),
        hint: Joi.string().max(200).allow('', null),
      }),
    ).min(1).max(8).required(),
  }).required(),
});

'use strict';

const Joi = require('@hapi/joi');
const { defineWidget } = require('./widget.contract');

const columnSchema = Joi.object({
  key: Joi.string().max(80).required(),
  label: Joi.string().max(120).required(),
  align: Joi.string().valid('left', 'right', 'center').default('left'),
  format: Joi.string().valid('text', 'number', 'currency', 'percent').default('text'),
});

const rowSchema = Joi.object().pattern(Joi.string().max(80), Joi.alternatives().try(
  Joi.string().max(500),
  Joi.number(),
  Joi.boolean(),
  Joi.allow(null),
));

module.exports = defineWidget({
  type: 'data_table',
  version: 1,
  title: 'Data table',
  library: 'markup',
  description:
    'Sortable-style tabular data with column definitions. Use for row-level results, rankings, breakdowns. Prefer over markdown tables when user may export.',
  aliases: ['table', 'grid', 'spreadsheet', 'list'],
  exportable: true,
  dataSchema: Joi.object({
    title: Joi.string().max(200).allow(''),
    columns: Joi.array().items(columnSchema).min(1).max(20).required(),
    rows: Joi.array().items(rowSchema).min(0).max(500).required(),
    caption: Joi.string().max(300).allow('', null),
  }).required(),
});

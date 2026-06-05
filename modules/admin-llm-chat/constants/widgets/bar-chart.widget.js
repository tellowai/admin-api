'use strict';

const Joi = require('@hapi/joi');
const { defineWidget } = require('./widget.contract');

const seriesSchema = Joi.object({
  name: Joi.string().max(80).required(),
  values: Joi.array().items(Joi.number().allow(null)).min(1).max(100).required(),
});

module.exports = defineWidget({
  type: 'bar_chart',
  version: 1,
  title: 'Bar chart',
  library: 'echarts',
  description: 'Vertical bar chart for comparing categories. Provide category labels and numeric series.',
  aliases: ['bar', 'column', 'histogram'],
  exportable: true,
  dataSchema: Joi.object({
    title: Joi.string().max(200).allow(''),
    categories: Joi.array().items(Joi.string().max(80)).min(1).max(100).required(),
    series: Joi.array().items(seriesSchema).min(1).max(8).required(),
    yAxisLabel: Joi.string().max(80).allow('', null),
    stacked: Joi.boolean().default(false),
  }).required(),
});

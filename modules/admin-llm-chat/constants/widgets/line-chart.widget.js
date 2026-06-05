'use strict';

const Joi = require('@hapi/joi');
const { defineWidget } = require('./widget.contract');

const seriesSchema = Joi.object({
  name: Joi.string().max(80).required(),
  values: Joi.array().items(Joi.number().allow(null)).min(1).max(366).required(),
});

module.exports = defineWidget({
  type: 'line_chart',
  version: 1,
  title: 'Line chart',
  library: 'echarts',
  description:
    'Time series or category line chart. Provide categories (x-axis labels) and one or more numeric series.',
  aliases: ['line', 'trend', 'time series', 'graph', 'chart'],
  exportable: true,
  dataSchema: Joi.object({
    title: Joi.string().max(200).allow(''),
    categories: Joi.array().items(Joi.string().max(80)).min(1).max(366).required(),
    series: Joi.array().items(seriesSchema).min(1).max(8).required(),
    yAxisLabel: Joi.string().max(80).allow('', null),
    xAxisLabel: Joi.string().max(80).allow('', null),
  }).required(),
});

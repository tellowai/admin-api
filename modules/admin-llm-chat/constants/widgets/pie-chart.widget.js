'use strict';

const Joi = require('@hapi/joi');
const { defineWidget } = require('./widget.contract');

module.exports = defineWidget({
  type: 'pie_chart',
  version: 1,
  title: 'Pie chart',
  library: 'echarts',
  description: 'Pie or donut chart for share/mix breakdowns. Provide named slices with numeric values.',
  aliases: ['pie', 'donut', 'share', 'mix'],
  exportable: true,
  dataSchema: Joi.object({
    title: Joi.string().max(200).allow(''),
    slices: Joi.array().items(
      Joi.object({
        name: Joi.string().max(80).required(),
        value: Joi.number().required(),
      }),
    ).min(1).max(24).required(),
    donut: Joi.boolean().default(false),
  }).required(),
});

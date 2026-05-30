'use strict';

const Joi = require('@hapi/joi');
const { defineWidget } = require('./widget.contract');

module.exports = defineWidget({
  type: 'vega_lite_chart',
  version: 1,
  title: 'Vega-Lite chart',
  library: 'vega',
  source: 'vega_lite',
  description:
    'Long-tail charts via Vega-Lite JSON spec. Use only when no static chart widget fits. Must include data in spec.',
  aliases: ['vega', 'custom chart'],
  exportable: false,
  enabled: true,
  dataSchema: Joi.object({
    title: Joi.string().max(200).allow(''),
    spec: Joi.object({
      $schema: Joi.string().uri().optional(),
      data: Joi.alternatives().try(Joi.object(), Joi.array()).optional(),
      mark: Joi.alternatives().try(Joi.string(), Joi.object()).optional(),
      layer: Joi.alternatives().try(Joi.array(), Joi.object()).optional(),
      encoding: Joi.object().optional(),
    })
      .or('mark', 'layer', 'encoding')
      .required(),
  }).required(),
});

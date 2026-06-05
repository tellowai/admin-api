'use strict';

const Joi = require('@hapi/joi');
const { defineWidget } = require('./widget.contract');

module.exports = defineWidget({
  type: 'callout',
  version: 1,
  title: 'Callout',
  library: 'markup',
  description: 'Highlighted note or alert (info, success, warning, error). Not for numeric data.',
  aliases: ['alert', 'notice', 'banner', 'warning'],
  exportable: false,
  dataSchema: Joi.object({
    variant: Joi.string().valid('info', 'success', 'warning', 'error').default('info'),
    title: Joi.string().max(200).allow(''),
    body: Joi.string().max(2000).required(),
  }).required(),
});

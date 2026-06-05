'use strict';

/**
 * JSON Schema fragments per widget data payload (reference / tests).
 * Provider tool schema uses a flat object; Joi in each *.widget.js enforces at runtime.
 * Kept in sync with Joi dataSchema in each widget file.
 */
const WIDGET_DATA_SCHEMAS = {
  kpi_cards: {
    type: 'object',
    required: ['cards'],
    properties: {
      title: { type: 'string' },
      cards: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: {
          type: 'object',
          required: ['label', 'value'],
          properties: {
            label: { type: 'string' },
            value: { oneOf: [{ type: 'string' }, { type: 'number' }] },
            delta: { type: 'string', maxLength: 80 },
            deltaDirection: { type: 'string', enum: ['up', 'down', 'neutral'] },
            hint: { type: 'string' },
          },
        },
      },
    },
    additionalProperties: false,
  },
  data_table: {
    type: 'object',
    required: ['columns', 'rows'],
    properties: {
      title: { type: 'string' },
      columns: {
        type: 'array',
        items: {
          type: 'object',
          required: ['key', 'label'],
          properties: {
            key: { type: 'string' },
            label: { type: 'string' },
            align: { type: 'string', enum: ['left', 'right', 'center'] },
            format: { type: 'string', enum: ['text', 'number', 'currency', 'percent'] },
          },
        },
      },
      rows: { type: 'array', items: { type: 'object' } },
      caption: { type: 'string' },
    },
    additionalProperties: false,
  },
  line_chart: {
    type: 'object',
    required: ['categories', 'series'],
    properties: {
      title: { type: 'string' },
      categories: { type: 'array', items: { type: 'string' } },
      series: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'values'],
          properties: {
            name: { type: 'string' },
            values: { type: 'array', items: { type: 'number' } },
          },
        },
      },
      yAxisLabel: { type: 'string' },
      xAxisLabel: { type: 'string' },
    },
    additionalProperties: false,
  },
  bar_chart: {
    type: 'object',
    required: ['categories', 'series'],
    properties: {
      title: { type: 'string' },
      categories: { type: 'array', items: { type: 'string' } },
      series: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'values'],
          properties: {
            name: { type: 'string' },
            values: { type: 'array', items: { type: 'number' } },
          },
        },
      },
      yAxisLabel: { type: 'string' },
      stacked: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  pie_chart: {
    type: 'object',
    required: ['slices'],
    properties: {
      title: { type: 'string' },
      slices: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'value'],
          properties: {
            name: { type: 'string' },
            value: { type: 'number' },
          },
        },
      },
      donut: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  callout: {
    type: 'object',
    required: ['body'],
    properties: {
      title: { type: 'string' },
      body: { type: 'string' },
      variant: { type: 'string', enum: ['info', 'success', 'warning', 'error'] },
    },
    additionalProperties: false,
  },
  vega_lite_chart: {
    type: 'object',
    required: ['spec'],
    properties: {
      title: { type: 'string' },
      spec: { type: 'object' },
    },
    additionalProperties: false,
  },
};

module.exports = { WIDGET_DATA_SCHEMAS };

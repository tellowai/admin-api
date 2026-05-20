'use strict';

const TOOL_DEFINITIONS = [
  {
    name: 'list_clickhouse_tables',
    description: 'List whitelisted ClickHouse tables available for analytics queries.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_table_schema',
    description: 'REQUIRED before query_clickhouse. Returns exact column names and the date filter column (often report_date, not date).',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name' },
      },
      required: ['table'],
      additionalProperties: false,
    },
  },
  {
    name: 'query_clickhouse',
    description: 'Run SELECT on one whitelisted table. Call get_table_schema first; use required_date_column in WHERE (report_date for daily stats). No JOINs.',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SELECT query' },
        max_rows: { type: 'integer', description: 'Max rows (default 1000)' },
      },
      required: ['sql'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_date_context',
    description: 'Get today, yesterday, and lookback dates in YYYY-MM-DD for the account timezone.',
    parameters: {
      type: 'object',
      properties: {
        tz: { type: 'string', description: 'IANA timezone, default Asia/Kolkata' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'remember',
    description: 'Store a fact for this user across future conversations.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
  },
];

function toOpenAITools(definitions) {
  return definitions.map((d) => ({
    type: 'function',
    function: {
      name: d.name,
      description: d.description,
      parameters: d.parameters,
    },
  }));
}

function toAnthropicTools(definitions) {
  return definitions.map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: d.parameters,
  }));
}

module.exports = {
  TOOL_DEFINITIONS,
  toOpenAITools,
  toAnthropicTools,
};

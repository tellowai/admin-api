'use strict';

const CONSTANTS = require('./admin-llm-chat.constants');

const TOOL_DEFINITIONS = [
  {
    name: 'list_clickhouse_tables',
    description: 'Discover all whitelisted analytics tables with short descriptions. Use first to choose which tables fit the user question — do not rely only on fixed cross-table recipes.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_table_schema',
    description: 'REQUIRED before query_clickhouse. Returns columns, date filter column, and optional related_tables hints (suggestions only — explore any whitelisted table that might help).',
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
    description: 'Run SELECT on one whitelisted table. Call get_table_schema first; use required_date_column in WHERE (report_date for daily stats). No JOINs — for cross-table questions run multiple queries and merge with analysis or run_analysis_code.',
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
    name: 'get_table_date_bounds',
    description: 'Earliest and latest dates with row count for a table within a bounded lookback window. Use instead of min(date)/max(date) queries without WHERE.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Whitelisted table name' },
        tz: { type: 'string', description: 'IANA timezone, default Asia/Kolkata' },
      },
      required: ['table'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_mysql_tables',
    description: 'List all tables in the transactional MySQL database (app data: users, orders, templates, credits, subscriptions, etc.). Use first to discover MySQL tables, then get_mysql_table_schema.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_mysql_table_schema',
    description: 'REQUIRED before query_mysql. Returns columns (name, type, key) for a MySQL table.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'MySQL table name' },
      },
      required: ['table'],
      additionalProperties: false,
    },
  },
  {
    name: 'query_mysql',
    description: 'Run a read-only SELECT/SHOW/DESCRIBE/EXPLAIN on the MySQL app database. Use for transactional/relational data (users, orders, templates, credits). JOINs are allowed in MySQL. Call get_mysql_table_schema first; results cap at max_rows (default 1000).',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Read-only SQL (SELECT/SHOW/DESCRIBE/EXPLAIN)' },
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
    name: 'run_analysis_code',
    description: 'Run sandboxed JavaScript on JSON inputs (e.g. rows from prior query_clickhouse calls). Use proactively to merge multi-table results, ratios, rankings, pivots. Set `result = ...` or return a JSON-serializable value. No require/network/files.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript function body; use inputs.* and assign result' },
        inputs: {
          type: 'object',
          description: 'Named datasets, e.g. { orders: [...], templates: [...] }',
          additionalProperties: true,
        },
      },
      required: ['code'],
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

function getEnabledToolDefinitions() {
  return TOOL_DEFINITIONS.filter((d) => {
    if (d.name === 'run_analysis_code' && !CONSTANTS.TOOL_RUN_ANALYSIS_CODE_ENABLED) return false;
    if (['query_clickhouse', 'get_table_schema', 'get_table_date_bounds', 'list_clickhouse_tables'].includes(d.name)
      && !CONSTANTS.TOOL_QUERY_CLICKHOUSE_ENABLED) return false;
    if (['query_mysql', 'get_mysql_table_schema', 'list_mysql_tables'].includes(d.name)
      && !CONSTANTS.TOOL_QUERY_MYSQL_ENABLED) return false;
    return true;
  });
}

module.exports = {
  TOOL_DEFINITIONS,
  getEnabledToolDefinitions,
  toOpenAITools,
  toAnthropicTools,
};

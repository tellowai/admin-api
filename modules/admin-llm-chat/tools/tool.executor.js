'use strict';

const clickhouseTool = require('./clickhouse.tool');
const { runAnalysisCode } = require('./analysis-code.tool');
const MemoryModel = require('../models/memory.model');

async function executeTool(name, args, { userId }) {
  const wrapped = (result) => ({
    ...result,
    envelope: `<tool_result tool="${name}">\n${JSON.stringify(result)}\n</tool_result>`,
  });

  switch (name) {
    case 'list_clickhouse_tables':
      return wrapped({ success: true, tables: clickhouseTool.listClickhouseTables() });
    case 'get_table_schema':
      return wrapped(clickhouseTool.getTableSchema(args));
    case 'query_clickhouse':
      return wrapped(await clickhouseTool.queryClickhouse(args));
    case 'get_date_context':
      return wrapped(clickhouseTool.getDateContext(args));
    case 'run_analysis_code':
      return wrapped(runAnalysisCode(args));
    case 'remember':
      await MemoryModel.upsertMemory(userId, args.key, args.value);
      return wrapped({ success: true, remembered: { key: args.key, value: args.value } });
    default:
      return wrapped({ success: false, error: 'UNKNOWN_TOOL', message: `Unknown tool: ${name}` });
  }
}

module.exports = { executeTool };

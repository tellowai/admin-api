'use strict';

const clickhouseTool = require('./clickhouse.tool');
const mysqlTool = require('./mysql.tool');
const { runAnalysisCode } = require('./analysis-code.tool');
const { renderWidget } = require('./render-widget.tool');
const memoryService = require('../services/memory.service');

async function executeTool(name, args, { userId, conversationId } = {}) {
  const wrapped = (result) => ({
    ...result,
    envelope: `<tool_result tool="${name}">\n${JSON.stringify(result)}\n</tool_result>`,
  });

  switch (name) {
    case 'list_clickhouse_tables':
      return wrapped({ success: true, tables: clickhouseTool.listClickhouseTables() });
    case 'get_table_schema':
      return wrapped(clickhouseTool.getTableSchema(args));
    case 'get_table_date_bounds':
      return wrapped(await clickhouseTool.getTableDateBounds(args));
    case 'query_clickhouse':
      return wrapped(await clickhouseTool.queryClickhouse(args));
    case 'list_mysql_tables':
      return wrapped(await mysqlTool.listMysqlTables());
    case 'get_mysql_table_schema':
      return wrapped(await mysqlTool.getMysqlTableSchema(args));
    case 'query_mysql':
      return wrapped(await mysqlTool.queryMysql(args));
    case 'get_date_context':
      return wrapped(clickhouseTool.getDateContext(args));
    case 'run_analysis_code':
      return wrapped(runAnalysisCode(args));
    case 'remember':
      await memoryService.upsertSemanticMemory(userId, args.key, args.value, {
        sourceConversationId: conversationId || null,
        metadataJson: { source: 'remember_tool' },
      });
      return wrapped({ success: true, remembered: { key: args.key, value: args.value } });
    case 'render_widget':
      return wrapped(renderWidget(args));
    default:
      return wrapped({ success: false, error: 'UNKNOWN_TOOL', message: `Unknown tool: ${name}` });
  }
}

module.exports = { executeTool };

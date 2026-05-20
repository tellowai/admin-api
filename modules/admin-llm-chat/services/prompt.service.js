'use strict';

const fs = require('fs');
const path = require('path');
const CONSTANTS = require('../constants/admin-llm-chat.constants');
const MemoryModel = require('../models/memory.model');
const schemaCache = require('./schema.cache.service');
const { redactValue, truncatePreview } = require('./pii.redactor');

const PROMPTS_DIR = path.join(__dirname, '../constants/system.prompts');
const BUSINESS_CONTEXT_PATH = path.join(__dirname, '../constants/business_context.json');

const VERBATIM_TAIL = 6;

function loadSystemPrompt(version = CONSTANTS.DEFAULT_SYSTEM_PROMPT_VERSION) {
  const file = path.join(PROMPTS_DIR, `${version}.system.txt`);
  return fs.readFileSync(file, 'utf8');
}

function loadBusinessContext() {
  try {
    return JSON.parse(fs.readFileSync(BUSINESS_CONTEXT_PATH, 'utf8'));
  } catch (_e) {
    return {};
  }
}

async function buildTableCatalog() {
  const snapshot = await schemaCache.getSchemaSnapshot();
  return Object.entries(snapshot)
    .map(([t, m]) => `- ${t}: ${m.description} (date column: ${m.required_date_column})`)
    .join('\n');
}

async function buildSystemPromptParts(userId, version = CONSTANTS.DEFAULT_SYSTEM_PROMPT_VERSION) {
  const base = loadSystemPrompt(version);
  const biz = loadBusinessContext();
  const tableCatalog = await buildTableCatalog();
  const memories = await MemoryModel.listByUser(userId);
  const memoryBlock = memories.length
    ? `\nUser preferences:\n${memories.map((m) => `- ${m.memory_key}: ${m.memory_value}`).join('\n')}`
    : '';
  const businessContext = `Business context:\n${JSON.stringify(biz, null, 2)}`;
  const tables = `Available ClickHouse tables:\n${tableCatalog}`;
  return {
    base,
    businessContext,
    tableCatalog: tables,
    memories: memoryBlock,
    full: `${base}\n\n${businessContext}\n\n${tables}${memoryBlock}`,
  };
}

async function buildSystemPrompt(userId, version) {
  const parts = await buildSystemPromptParts(userId, version);
  return parts.full;
}

function parseContentParts(m) {
  if (!m.content_parts) return null;
  try {
    return typeof m.content_parts === 'string' ? JSON.parse(m.content_parts) : m.content_parts;
  } catch (_e) {
    return null;
  }
}

function getTraceFromMessage(m) {
  const parts = parseContentParts(m);
  if (parts && Array.isArray(parts.trace)) return parts.trace;
  return null;
}

function toProviderToolCall(tc, activeProvider) {
  const argsRaw = typeof tc.arguments_json === 'string'
    ? tc.arguments_json
    : JSON.stringify(tc.arguments_json || {});
  const argsStr = typeof argsRaw === 'string' ? argsRaw : JSON.stringify(argsRaw);
  if (activeProvider === 'openai') {
    return {
      id: tc.tool_call_id,
      type: 'function',
      function: {
        name: tc.tool_name,
        arguments: argsStr,
      },
    };
  }
  return {
    id: tc.tool_call_id,
    name: tc.tool_name,
    arguments: typeof tc.arguments_json === 'string'
      ? JSON.parse(tc.arguments_json)
      : (tc.arguments_json || {}),
  };
}

function flattenToolCallsForProvider(toolCalls, activeProvider, msgProvider) {
  if (!toolCalls?.length) return [];
  if (msgProvider === activeProvider) {
    const rows = [];
    toolCalls.forEach((tc) => {
      rows.push({
        role: 'assistant',
        content: null,
        tool_calls: [toProviderToolCall(tc, activeProvider)],
      });
      const result = typeof tc.result_json === 'string' ? tc.result_json : JSON.stringify(tc.result_json || {});
      rows.push({
        role: 'tool',
        tool_call_id: tc.tool_call_id,
        content: truncatePreview(redactValue(result)),
      });
    });
    return rows;
  }

  const blocks = toolCalls.map((tc) => {
    const args = typeof tc.arguments_json === 'string' ? tc.arguments_json : JSON.stringify(tc.arguments_json || {});
    const result = typeof tc.result_json === 'string' ? tc.result_json : JSON.stringify(tc.result_json || {});
    return [
      `[Used tool: ${tc.tool_name}]`,
      `Args: ${truncatePreview(redactValue(args), 512)}`,
      `Result (${tc.rows_returned ?? '?'} rows): ${truncatePreview(redactValue(result), 1024)}`,
    ].join('\n');
  }).join('\n\n');
  return [{ role: 'assistant', content: blocks }];
}

function normalizeContent(m, supportsVision) {
  let content = m.content;
  const parts = parseContentParts(m);
  if (parts && Array.isArray(parts) && parts[0]?.type) {
    if (!supportsVision) {
      return parts.map((p) => {
        if (p.type === 'image' || p.type === 'image_url') {
          return { type: 'text', text: '[image omitted: switched to text-only model]' };
        }
        return p;
      });
    }
    return parts;
  }
  if (parts && Array.isArray(parts)) content = parts;
  return content;
}

function messageToApiRows(m, activeProvider, supportsVision) {
  const trace = getTraceFromMessage(m);
  if (trace?.length) {
    const lastTextIdx = trace.map((s, i) => (s.type === 'text' ? i : -1)).filter((i) => i >= 0).pop();
    const rows = [];
    trace.forEach((seg, idx) => {
      if (seg.type === 'text') {
        const isFinal = idx === lastTextIdx;
        if (!isFinal && seg.text) {
          rows.push({ role: 'assistant', content: seg.text });
        }
      } else if (seg.type === 'tool') {
        rows.push(...flattenToolCallsForProvider([{
          tool_call_id: seg.toolCallId,
          tool_name: seg.name,
          arguments_json: seg.args,
          result_json: seg.resultPreview,
          rows_returned: seg.rowsReturned,
        }], activeProvider, m.model_provider || activeProvider));
      }
    });
    return rows;
  }

  if (m.role === 'tool') {
    const content = typeof m.content === 'string'
      ? m.content
      : JSON.stringify(m.content || m.content_stub || {});
    return [{
      role: 'tool',
      tool_call_id: m.tool_call_id,
      content,
    }];
  }

  if (m.tool_calls?.length) {
    const base = m.content ? [{ role: 'assistant', content: m.content }] : [];
    return [...base, ...flattenToolCallsForProvider(m.tool_calls, activeProvider, m.model_provider || activeProvider)];
  }

  return [{
    role: m.role,
    content: normalizeContent(m, supportsVision),
  }];
}

/** OpenAI requires each tool message to follow an assistant message with matching tool_calls. */
function repairOpenaiToolMessageSequence(apiRows) {
  const out = [];
  for (const row of apiRows) {
    if (row.role === 'tool') {
      const prev = out[out.length - 1];
      const prevIds = prev?.tool_calls?.map((tc) => tc.id || tc.tool_call_id) || [];
      const matches = prev?.role === 'assistant'
        && prev.tool_calls?.length
        && prevIds.includes(row.tool_call_id);
      if (!matches) {
        const body = typeof row.content === 'string' ? row.content : JSON.stringify(row.content || {});
        out.push({ role: 'assistant', content: `[Tool result]: ${truncatePreview(body, 2048)}` });
        continue;
      }
    }
    out.push(row);
  }
  return out;
}

function sanitizeMessageRow(row, activeProvider) {
  const out = { ...row };
  if (!out.tool_calls?.length) {
    delete out.tool_calls;
  } else if (activeProvider === 'openai') {
    out.tool_calls = out.tool_calls.map((tc) => {
      if (tc.type === 'function' && tc.function?.name) return tc;
      const args = tc.arguments ?? tc.function?.arguments ?? {};
      return {
        id: tc.id || tc.tool_call_id,
        type: 'function',
        function: {
          name: tc.name || tc.function?.name,
          arguments: typeof args === 'string' ? args : JSON.stringify(args),
        },
      };
    });
    if (out.role === 'assistant' && !out.content) out.content = null;
  }
  if (out.role === 'assistant' && !out.tool_calls?.length && (out.content == null || out.content === '')) {
    out.content = out.content || '';
  }
  return out;
}

function buildMessagesForProvider(history, systemText, options = {}) {
  const {
    activeProvider,
    supportsVision = true,
    summary = null,
  } = options;

  let rows = [...history];
  if (summary?.through_sequence_no != null) {
    rows = rows.filter((m) => (m.sequence_no || 0) > summary.through_sequence_no);
  }

  const tailStart = Math.max(0, rows.length - VERBATIM_TAIL);
  const apiRows = [];

  if (summary?.summary_text) {
    apiRows.push({
      role: 'system',
      content: `Summary of earlier conversation (auto-generated):\n${summary.summary_text}`,
    });
  }

  apiRows.push({ role: 'system', content: systemText });

  rows.forEach((m, idx) => {
    if (m.role === 'system' || m.is_hidden) return;
    const forceVerbatim = idx >= tailStart;
    if (forceVerbatim) {
      apiRows.push(...messageToApiRows(m, activeProvider, supportsVision));
      return;
    }
    const msgProvider = m.model_provider || activeProvider;
    if (msgProvider === activeProvider) {
      apiRows.push(...messageToApiRows(m, activeProvider, supportsVision));
    } else {
      apiRows.push(...messageToApiRows(m, activeProvider, supportsVision));
    }
  });

  let sanitized = apiRows.map((row) => sanitizeMessageRow(row, activeProvider));
  if (activeProvider === 'openai') {
    sanitized = repairOpenaiToolMessageSequence(sanitized);
  }
  return sanitized;
}

module.exports = {
  loadSystemPrompt,
  loadBusinessContext,
  buildSystemPrompt,
  buildSystemPromptParts,
  buildMessagesForProvider,
  messageToApiRows,
  flattenToolCallsForProvider,
  saveBusinessContext: (data) => {
    fs.writeFileSync(BUSINESS_CONTEXT_PATH, JSON.stringify(data, null, 2));
  },
};

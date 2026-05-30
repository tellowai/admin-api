'use strict';

const { v4: uuidv4 } = require('uuid');
const LLMProviderFactory = require('../../ai-services/factories/llm.provider.factory');
const { getEnabledToolDefinitions, toOpenAITools, toAnthropicTools } = require('../constants/tool.registry');
const CONSTANTS = require('../constants/admin-llm-chat.constants');
const { executeTool } = require('../tools/tool.executor');
const MessageModel = require('../models/message.model');
const ToolCallModel = require('../models/tool_call.model');
const ConversationModel = require('../models/conversation.model');
const conversationData = require('./conversation-data.service');
const UsageModel = require('../models/usage.model');
const ContextSummaryModel = require('../models/context.summary.model');
const promptService = require('./prompt.service');
const contextSummaryService = require('./context.summary.service');
const contextBreakdown = require('./context.breakdown.service');
const attachmentResolver = require('./attachment.resolver.service');
const AttachmentModel = require('../models/attachment.model');
const titleService = require('./conversation.title.service');
const { formatProviderError } = require('./provider-error.util');
const messageScope = require('./message-scope.util');
const { redactValue, redactString, truncatePreview } = require('./pii.redactor');
const logger = require('../../../config/lib/logger');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');

function estimateCost(modelMeta, tokensIn, tokensOut) {
  return ((tokensIn / 1e6) * modelMeta.inputCostPer1M + (tokensOut / 1e6) * modelMeta.outputCostPer1M);
}

/** True when the model supplied enough arguments to run the tool (not just {}). */
function toolCallArgsReady(name, args) {
  const a = args && typeof args === 'object' ? args : {};
  switch (name) {
    case 'query_mysql':
    case 'query_clickhouse':
      return Boolean(String(a.sql || '').trim());
    case 'run_analysis_code':
      return Boolean(String(a.code || '').trim());
    case 'get_table_schema':
    case 'get_table_date_bounds':
    case 'get_mysql_table_schema':
      return Boolean(String(a.table || '').trim());
    case 'remember':
      return Boolean(String(a.key || '').trim());
    case 'render_widget':
      return Boolean(String(args?.widget_type || '').trim() && args?.data && typeof args.data === 'object');
    default:
      return true;
  }
}

function cancelledToolResult(name, reason = 'STREAM_ABORTED') {
  const result = {
    success: false,
    error: reason,
    message: 'Tool call cancelled because the stream was interrupted.',
    retryable: true,
  };
  return {
    ...result,
    envelope: `<tool_result tool="${name}">\n${JSON.stringify(result)}\n</tool_result>`,
  };
}

/** Human-readable tool output for UI trace (not LLM envelope XML). */
function formatToolResultPreview(result) {
  if (!result || typeof result !== 'object') return result;
  if (Array.isArray(result.rows)) {
    return {
      success: result.success !== false,
      error: result.error || null,
      message: result.message || null,
      rowCount: result.rows.length,
      preview: result.rows.slice(0, 5),
    };
  }
  if (typeof result.envelope === 'string') {
    const m = result.envelope.match(/<tool_result[^>]*>\s*([\s\S]*?)\s*<\/tool_result>/i);
    if (m) {
      try {
        return JSON.parse(m[1]);
      } catch {
        return m[1].trim();
      }
    }
  }
  const { envelope: _omit, ...rest } = result;
  return rest;
}

class TurnTraceBuilder {
  constructor(sendEvent) {
    this.sendEvent = sendEvent;
    this.trace = [];
    this.segmentIndex = -1;
    this.currentKind = null;
    this.textBuffer = '';
    this.finalTextSegmentIndex = null;
  }

  startSegment(kind) {
    if (this.currentKind === 'text' && this.textBuffer) {
      this.trace[this.segmentIndex].text = this.textBuffer;
      this.sendEvent('segment_end', {
        kind: 'text',
        index: this.segmentIndex,
        text: this.textBuffer,
      });
      this.textBuffer = '';
    }
    this.segmentIndex += 1;
    this.currentKind = kind;
    this.sendEvent('segment_start', { kind, index: this.segmentIndex });
    if (kind === 'text') {
      this.trace.push({ type: 'text', text: '' });
    } else {
      this.trace.push({
        type: 'tool',
        toolCallId: null,
        name: null,
        args: {},
        status: 'running',
        durationMs: null,
        rowsReturned: null,
        resultPreview: null,
      });
    }
  }

  appendText(text) {
    if (this.currentKind !== 'text') this.startSegment('text');
    else if (this.segmentIndex < 0) this.startSegment('text');
    this.textBuffer += text;
    if (this.trace[this.segmentIndex]) {
      this.trace[this.segmentIndex].text = this.textBuffer;
    }
  }

  markFinalSegment() {
    if (this.currentKind === 'text') {
      this.finalTextSegmentIndex = this.segmentIndex;
      this.sendEvent('final_segment', { index: this.segmentIndex });
    }
  }

  onToolStart({ id, name }) {
    // Always create a new tool segment per call so parallel/sequential tool
    // calls in the same round each get their own card in the persisted trace.
    this.startSegment('tool');
    const seg = this.trace[this.segmentIndex];
    if (seg) {
      seg.toolCallId = id;
      seg.name = name;
    }
  }

  onToolEnd({ id, name, arguments: args, durationMs, result }) {
    let seg = id != null
      ? this.trace.find((s) => s.type === 'tool' && s.toolCallId === id)
      : null;
    if (!seg) {
      seg = [...this.trace].reverse().find(
        (s) => s.type === 'tool' && s.status === 'running' && (!name || s.name === name),
      );
    }
    if (!seg) {
      seg = [...this.trace].reverse().find((s) => s.type === 'tool' && s.status === 'running');
    }
    if (seg && seg.type === 'tool') {
      seg.toolCallId = id;
      seg.name = name;
      seg.args = redactValue(args || {});
      seg.status = result?.success === false ? 'failed' : 'completed';
      seg.durationMs = durationMs;
      seg.rowsReturned = result?.rows?.length ?? null;
      seg.resultPreview = truncatePreview(redactValue(formatToolResultPreview(result)), 2048);
    }
    this.sendEvent('segment_end', {
      kind: 'tool',
      index: this.segmentIndex,
      toolCallId: id,
      status: seg?.status || 'completed',
      durationMs,
    });
    this.currentKind = null;
  }

  onWidget(widgetSpec) {
    if (this.currentKind === 'text' && this.textBuffer) {
      this.trace[this.segmentIndex].text = this.textBuffer;
      this.sendEvent('segment_end', {
        kind: 'text',
        index: this.segmentIndex,
        text: this.textBuffer,
      });
      this.textBuffer = '';
      this.currentKind = null;
    }
    this.segmentIndex += 1;
    const seg = {
      type: 'widget',
      source: widgetSpec.source || 'static_widget',
      widget: widgetSpec.widget,
      version: widgetSpec.version,
      data: widgetSpec.data,
      exportable: Boolean(widgetSpec.exportable),
      status: 'completed',
    };
    this.trace.push(seg);
    this.sendEvent('widget', {
      index: this.segmentIndex,
      source: seg.source,
      widget: seg.widget,
      version: seg.version,
      data: seg.data,
      exportable: seg.exportable,
    });
    this.sendEvent('segment_end', {
      kind: 'widget',
      index: this.segmentIndex,
      widget: seg.widget,
    });
    this.currentKind = null;
  }

  finalize() {
    if (this.currentKind === 'text' && this.textBuffer) {
      this.trace[this.segmentIndex].text = this.textBuffer;
      this.sendEvent('segment_end', {
        kind: 'text',
        index: this.segmentIndex,
        text: this.textBuffer,
      });
    }
    this.trace.forEach((seg) => {
      if (seg.type === 'tool' && seg.status === 'running') {
        seg.status = 'completed';
      }
    });
    const content = this.finalTextSegmentIndex != null
      ? (this.trace[this.finalTextSegmentIndex]?.text || '')
      : '';
    return { trace: this.trace, content, content_parts: { trace: this.trace } };
  }
}

/** Stream a fixed refusal without calling the LLM (off-topic guard). */
async function runRefusalTurn({
  conversation,
  userId,
  modelMeta,
  userMessage,
  refusalText,
  res,
  sendEvent,
}) {
  const seq = await MessageModel.nextSequenceNo(conversation.conversation_id);
  const turnId = uuidv4();
  const userMsgId = uuidv4();
  const assistantMsgId = uuidv4();

  await MessageModel.createMany([
    {
      message_id: userMsgId,
      conversation_id: conversation.conversation_id,
      turn_id: turnId,
      client_message_id: userMessage.client_message_id || null,
      role: 'user',
      content: userMessage.content,
      sequence_no: seq,
    },
    {
      message_id: assistantMsgId,
      conversation_id: conversation.conversation_id,
      turn_id: turnId,
      role: 'assistant',
      content: '',
      model_provider: modelMeta.provider,
      model_id: modelMeta.id,
      sequence_no: seq + 1,
      finish_reason: 'in_progress',
    },
  ]);

  await ConversationModel.touchUpdatedAt(conversation.conversation_id);

  sendEvent('meta', {
    conversationId: conversation.conversation_id,
    messageId: assistantMsgId,
    model: modelMeta.id,
    provider: modelMeta.provider,
  });

  const trace = [{ type: 'text', text: refusalText }];
  sendEvent('segment_start', { kind: 'text', index: 0 });
  for (const chunk of refusalText.split(/(\s+)/)) {
    if (chunk) sendEvent('token', { text: chunk });
  }
  sendEvent('segment_end', { kind: 'text', index: 0 });
  sendEvent('final_segment', { index: 0 });

  const startedAt = Date.now();
  await MessageModel.finalize(assistantMsgId, {
    content: refusalText,
    content_parts: { trace },
    finish_reason: 'stop',
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    latency_ms: Date.now() - startedAt,
  });

  sendEvent('done', {
    finishReason: 'stop',
    content: refusalText,
    trace,
    usage: {
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      effectiveContextTokens: (conversation.total_tokens_in || 0) + (conversation.total_tokens_out || 0),
      contextLimit: modelMeta.contextWindow || 128000,
      contextPct: 0,
    },
  });
}

async function runStreamingTurn({
  conversation,
  userId,
  modelMeta,
  userMessage,
  attachmentIds,
  res,
  sendEvent,
  signal,
}) {
  if (!modelMeta) {
    sendEvent('error', { code: 'MODEL_NOT_CONFIGURED', message: 'No LLM models configured', retryable: false });
    sendEvent('done', { finishReason: 'error' });
    return;
  }

  if (userMessage.client_message_id) {
    const dup = await MessageModel.findByClientMessageId(conversation.conversation_id, userMessage.client_message_id);
    if (dup) {
      sendEvent('error', { code: 'DUPLICATE_MESSAGE', message: 'This message was already sent.', retryable: false });
      sendEvent('done', { finishReason: 'duplicate', messageId: dup.message_id });
      return;
    }
  }

  const scopeCheck = messageScope.evaluateUserMessage(userMessage.content);
  if (scopeCheck.refuse) {
    await runRefusalTurn({
      conversation,
      userId,
      modelMeta,
      userMessage,
      refusalText: scopeCheck.message,
      res,
      sendEvent,
    });
    return;
  }

  let summary = await ContextSummaryModel.getLatest(conversation.conversation_id);
  const pendingUserContent = typeof userMessage.content === 'string' ? userMessage.content : '';

  const breakdownOpts = { pendingUserContent, summary };
  let effectivePct = await contextSummaryService.computeEffectiveUsedPct(
    conversation,
    modelMeta,
    userId,
    breakdownOpts,
  );

  const shouldRunSummary = await contextSummaryService.shouldSummarize(
    conversation,
    modelMeta,
    userId,
    breakdownOpts,
  );

  if (shouldRunSummary) {
    sendEvent('context_summarizing', { reason: 'context_window', usedPct: effectivePct });
    summary = await contextSummaryService.summarize(conversation, { userId }) || summary;
    if (summary) {
      const postSummaryUsage = await contextBreakdown.computeForConversation(conversation, userId, {
        pendingUserContent,
        summary,
      });
      effectivePct = postSummaryUsage?.pct ?? effectivePct;
      if (postSummaryUsage) {
        sendEvent('context_usage', postSummaryUsage);
      }
      sendEvent('context_summarized', {
        summaryId: summary.summary_id,
        throughSequenceNo: summary.through_sequence_no,
        throughMessageId: summary.through_message_id,
        summaryPreview: truncatePreview(redactString(summary.summary_text || ''), 1200),
        summarizerProvider: summary.summarizer_provider,
        summarizerModelId: summary.summarizer_model_id,
        usedPct: effectivePct,
        contextUsage: postSummaryUsage,
      });
      if (global.kafkaProducer) {
        kafkaCtrl.sendMessage(
          TOPICS.ADMIN_LLM_CHAT_CONTEXT_SUMMARIZED,
          [{ value: { conversation_id: conversation.conversation_id, user_id: userId, summary_id: summary.summary_id } }],
          'admin_llm_chat_context_summarized',
        ).catch(() => {});
      }
    }
  }

  let resolvedUser;
  try {
    resolvedUser = await attachmentResolver.resolveAttachmentsForTurn(
      attachmentIds,
      userId,
      conversation.conversation_id,
      {
        userText: userMessage.content,
        supportsVision: modelMeta.supportsVision !== false,
      },
    );
  } catch (err) {
    if (err.code === 'INVALID_ATTACHMENTS') {
      sendEvent('error', { code: 'INVALID_ATTACHMENTS', message: err.message, retryable: false });
      sendEvent('done', { finishReason: 'error' });
      return;
    }
    throw err;
  }

  const [systemParts, historyPayload] = await Promise.all([
    promptService.buildSystemPromptParts(userId, conversation.system_prompt_version),
    conversationData.loadMessagesWithTools(conversation.conversation_id),
  ]);
  const systemText = systemParts.full;
  const anthropicSystem = promptService.buildAnthropicSystemParam(systemParts);
  const history = historyPayload.messages;

  const seq = await MessageModel.nextSequenceNo(conversation.conversation_id);
  const turnId = uuidv4();
  const userMsgId = uuidv4();
  const assistantMsgId = uuidv4();
  const assistantSeq = seq + 1;

  // Close any orphaned in_progress rows from a previously abandoned turn before
  // starting this one. The controller already blocks concurrent streams, so this
  // can only match stale rows, never a live one.
  await MessageModel.finalizeStaleInProgress(conversation.conversation_id);

  await MessageModel.createMany([
    {
      message_id: userMsgId,
      conversation_id: conversation.conversation_id,
      turn_id: turnId,
      client_message_id: userMessage.client_message_id || null,
      role: 'user',
      content: typeof resolvedUser.content === 'string'
        ? resolvedUser.content
        : (resolvedUser.content?.find((p) => p.type === 'text')?.text || userMessage.content),
      content_parts: resolvedUser.content_parts
        || (Array.isArray(resolvedUser.content) ? resolvedUser.content : userMessage.content_parts || null),
      sequence_no: seq,
    },
    {
      message_id: assistantMsgId,
      conversation_id: conversation.conversation_id,
      turn_id: turnId,
      role: 'assistant',
      content: '',
      model_provider: modelMeta.provider,
      model_id: modelMeta.id,
      sequence_no: assistantSeq,
      finish_reason: 'in_progress',
    },
  ]);

  if (attachmentIds?.length) {
    await AttachmentModel.linkToMessage(attachmentIds, userMsgId);
  }

  await ConversationModel.touchUpdatedAt(conversation.conversation_id);

  const userTurnMessage = {
    role: 'user',
    content: resolvedUser.content,
    content_parts: resolvedUser.content_parts,
    sequence_no: seq,
  };

  const historyWithUser = [
    ...history,
    userTurnMessage,
  ];
  let turnContextUsage = await contextBreakdown.computeBreakdown({
    conversation,
    userId,
    modelMeta,
    history: historyWithUser,
    summary,
  });
  if (turnContextUsage) {
    sendEvent('context_usage', turnContextUsage);
  }

  sendEvent('meta', {
    conversationId: conversation.conversation_id,
    messageId: assistantMsgId,
    model: modelMeta.id,
    provider: modelMeta.provider,
  });

  const provider = await LLMProviderFactory.createProvider(modelMeta.provider);
  const traceBuilder = new TurnTraceBuilder(sendEvent);
  let toolCallCount = 0;
  const maxTools = CONSTANTS.MAX_TOOL_CALLS_PER_TURN;
  let turnTokensIn = 0;
  let turnTokensOut = 0;
  let sawToolThisRound = false;
  let budgetExhausted = false;
  let hadQueryRowsThisTurn = false;
  const turnExtraMessages = [];

  const runLoop = async ({ allowTools = true, summaryNudge = false } = {}) => {
    const includeRenderWidget = !allowTools || hadQueryRowsThisTurn || summaryNudge;
    const toolDefs = getEnabledToolDefinitions({ includeRenderWidget });
    const activeTools = allowTools
      ? (modelMeta.provider === 'anthropic' ? toAnthropicTools(toolDefs) : toOpenAITools(toolDefs))
      : undefined;
    const summaryNudgeContent = userId === CONSTANTS.DIGEST_SYSTEM_USER_ID
      ? CONSTANTS.DIGEST_SUMMARY_NUDGE
      : 'Based on the tool results above, answer the user now. Do not call more tools. If you had numeric/time-series data and did not call render_widget yet, you should have — do not paste chart JSON in text; summarize in prose only for this round. Direct answer first, then **Analysis** with period-over-period comparison (e.g. vs prior week). Business language only — no table names, schemas, or tool narration. Call out anomalies and what worked best. **Recommendations** only if off-track or clear levers; omit if on par/growing. If blocked, say what is missing in data, not how many queries you ran.';
    const nudge = summaryNudge
      ? [{
        role: 'user',
        content: summaryNudgeContent,
        sequence_no: seq,
      }]
      : [];
    const baseHistory = [
      ...history,
      userTurnMessage,
      ...turnExtraMessages,
      ...nudge,
    ];
    const messages = promptService.buildMessagesForProvider(baseHistory, systemText, {
      activeProvider: modelMeta.provider,
      supportsVision: modelMeta.supportsVision !== false,
      summary,
    });

    const pendingToolCalls = [];
    let roundTokensIn = 0;
    let roundTokensOut = 0;

    if (!allowTools) {
      traceBuilder.markFinalSegment();
    }

    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }

    const roundAbort = new AbortController();
    const onParentAbort = () => roundAbort.abort();
    if (signal) {
      signal.addEventListener('abort', onParentAbort, { once: true });
    }

    try {
    await new Promise((resolve, reject) => {
      provider.streamChatCompletion({
        model: modelMeta.id,
        messages: modelMeta.provider === 'anthropic' ? messages.filter((m) => m.role !== 'system') : messages,
        system: modelMeta.provider === 'anthropic'
          ? anthropicSystem
          : undefined,
        tools: activeTools,
        maxTokens: modelMeta.maxOutputTokens,
        signal: roundAbort.signal,
        onDelta: ({ text }) => {
          sendEvent('thinking', {});
          traceBuilder.appendText(text);
          // Tool-planning chatter stays in reasoning trace only; final answer round streams to UI.
          if (!allowTools) {
            sendEvent('token', { text });
          }
        },
        onThinking: () => sendEvent('thinking', {}),
        onToolCallStart: ({ id, name }) => {
          sawToolThisRound = true;
          pendingToolCalls.push({ id, name, arguments: {} });
          if (name !== 'render_widget') {
            traceBuilder.onToolStart({ id, name });
            sendEvent('tool_start', { toolCallId: id, name });
          }
        },
        onToolCallEnd: ({ id, name, arguments: args }) => {
          const tc = pendingToolCalls.find((t) => t.id === id) || { id, name, arguments: args };
          tc.arguments = args;
        },
        onFinish: async ({ usage }) => {
          roundTokensIn += usage?.tokensIn || 0;
          roundTokensOut += usage?.tokensOut || 0;
          resolve();
        },
        onError: (err) => reject(err),
      });
    });
    } finally {
      if (signal) {
        signal.removeEventListener('abort', onParentAbort);
      }
    }

    turnTokensIn += roundTokensIn;
    turnTokensOut += roundTokensOut;

    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }

    if (pendingToolCalls.length && toolCallCount < maxTools) {
      if (!sawToolThisRound) traceBuilder.markFinalSegment();
      sendEvent('thinking', { phase: 'tools' });
      const callsForRound = [...pendingToolCalls];
      const toolResults = [];
      const toolRowsToInsert = [];
      for (const tc of callsForRound) {
        if (signal?.aborted) {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          throw err;
        }
        toolCallCount += 1;
        const start = Date.now();
        const argsReady = toolCallArgsReady(tc.name, tc.arguments);
        const result = (!argsReady && signal?.aborted)
          ? cancelledToolResult(tc.name)
          : await executeTool(tc.name, tc.arguments, { userId });
        const durationMs = Date.now() - start;
        if (['query_clickhouse', 'query_mysql'].includes(tc.name)
          && result.success !== false
          && (result.rows?.length > 0 || result.row_count > 0)) {
          hadQueryRowsThisTurn = true;
        }
        toolRowsToInsert.push({
          tool_call_id: tc.id,
          message_id: assistantMsgId,
          tool_name: tc.name,
          arguments_json: redactValue(tc.arguments),
          result_json: result.envelope,
          status: result.success === false ? 'failed' : 'completed',
          duration_ms: durationMs,
          rows_returned: result.rows?.length,
          error_code: result.error || null,
        });
        if (tc.name === 'render_widget' && result.widgetSpec) {
          traceBuilder.onWidget(result.widgetSpec);
          sendEvent('tool_end', {
            toolCallId: tc.id,
            name: tc.name,
            durationMs,
            status: 'completed',
            resultPreview: { rendered: result.widgetSpec.widget },
          });
        } else {
          if (tc.name === 'render_widget' && result.success === false) {
            traceBuilder.onToolStart({ id: tc.id, name: tc.name });
            sendEvent('tool_start', { toolCallId: tc.id, name: tc.name });
          }
          traceBuilder.onToolEnd({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            durationMs,
            result,
          });
          sendEvent('tool_end', {
            toolCallId: tc.id,
            name: tc.name,
            durationMs,
            args: redactValue(tc.arguments || {}),
            status: result.success === false ? 'failed' : 'completed',
            resultPreview: truncatePreview(redactValue(formatToolResultPreview(result)), 2048),
            rowsReturned: result.rows?.length ?? null,
          });
        }
        const toolContent = typeof result.envelope === 'string'
          ? result.envelope
          : JSON.stringify(result.envelope || {});
        toolResults.push({
          tool_call_id: tc.id,
          content: toolContent,
        });
      }
      if (toolRowsToInsert.length) {
        await ToolCallModel.createMany(toolRowsToInsert);
      }
      pendingToolCalls.length = 0;
      const resultsById = new Map(toolResults.map((t) => [t.tool_call_id, t.content]));
      turnExtraMessages.push({
        role: 'assistant',
        content: null,
        model_provider: modelMeta.provider,
        tool_calls: callsForRound.map((tc) => ({
          tool_call_id: tc.id,
          tool_name: tc.name,
          arguments_json: tc.arguments,
          result_json: resultsById.get(tc.id) || '',
        })),
      });
      return runLoop({ allowTools: true });
    }

    if (pendingToolCalls.length) {
      budgetExhausted = true;
      const skipped = [...pendingToolCalls];
      pendingToolCalls.length = 0;
      const skippedEnvelope = JSON.stringify({
        success: false,
        error: 'TOOL_BUDGET_EXHAUSTED',
        message: `Tool call skipped: per-turn budget of ${maxTools} tool calls reached. Answer the user with what you have. The user can tap "Continue analysis" to resume in a new turn with a fresh budget.`,
      });
      sendEvent('tool_budget_exhausted', {
        maxTools,
        toolCallsUsed: toolCallCount,
        skippedCount: skipped.length,
      });
      const skippedToolCalls = [];
      for (const tc of skipped) {
        traceBuilder.onToolEnd({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          durationMs: 0,
          result: {
            success: false,
            error: 'TOOL_BUDGET_EXHAUSTED',
            message: `Per-turn tool budget of ${maxTools} reached.`,
          },
        });
        sendEvent('tool_end', {
          toolCallId: tc.id,
          name: tc.name,
          durationMs: 0,
          status: 'failed',
          resultPreview: { success: false, error: 'TOOL_BUDGET_EXHAUSTED' },
        });
        skippedToolCalls.push({
          tool_call_id: tc.id,
          tool_name: tc.name,
          arguments_json: tc.arguments,
          result_json: skippedEnvelope,
        });
      }
      // Preserve provider tool-call/tool-result pairing for the next round.
      turnExtraMessages.push({
        role: 'assistant',
        content: null,
        model_provider: modelMeta.provider,
        tool_calls: skippedToolCalls,
      });
      await runLoop({ allowTools: false, summaryNudge: true });
    } else {
      traceBuilder.markFinalSegment();
    }
  };

  const startedAt = Date.now();
  try {
    await runLoop({});
    traceBuilder.markFinalSegment();
    let { trace, content, content_parts } = traceBuilder.finalize();
    if (!String(content || '').trim() && turnExtraMessages.length) {
      await runLoop({ allowTools: false, summaryNudge: true });
      traceBuilder.markFinalSegment();
      const again = traceBuilder.finalize();
      trace = again.trace;
      content = again.content || content;
      content_parts = again.content_parts;
    }
    const costUsd = estimateCost(modelMeta, turnTokensIn, turnTokensOut);
    const latencyMs = Date.now() - startedAt;

    await Promise.all([
      MessageModel.finalize(assistantMsgId, {
        content,
        content_parts,
        finish_reason: budgetExhausted ? 'tool_budget_exhausted' : 'stop',
        tokens_in: turnTokensIn,
        tokens_out: turnTokensOut,
        cost_usd: costUsd,
        latency_ms: latencyMs,
      }),
      ConversationModel.addUsageTotals(conversation.conversation_id, turnTokensIn, turnTokensOut, costUsd),
      UsageModel.incrementDaily(userId, {
        tokensIn: turnTokensIn,
        tokensOut: turnTokensOut,
        costUsd,
        messages: 2,
        toolCalls: toolCallCount,
      }),
    ]);

    turnContextUsage = await contextBreakdown.computeBreakdown({
      conversation: {
        ...conversation,
        total_tokens_in: (conversation.total_tokens_in || 0) + turnTokensIn,
        total_tokens_out: (conversation.total_tokens_out || 0) + turnTokensOut,
      },
      userId,
      modelMeta,
      history: [
        ...historyWithUser,
        { role: 'assistant', content, model_provider: modelMeta.provider, model_id: modelMeta.id },
      ],
      summary,
    }) || turnContextUsage;
    const effectiveTokens = turnContextUsage?.effectiveTokens ?? 0;
    const contextLimit = turnContextUsage?.limit || modelMeta.contextWindow || 128000;
    const contextPct = turnContextUsage?.pct ?? (contextLimit > 0 ? effectiveTokens / contextLimit : 0);

    logger.info('admin_llm_chat turn', {
      conversationId: conversation.conversation_id,
      userId,
      provider: modelMeta.provider,
      model: modelMeta.id,
      tokensIn: turnTokensIn,
      tokensOut: turnTokensOut,
      costUsd,
      latencyMs,
      toolCallCount,
      contextPct,
    });

    if (global.kafkaProducer) {
      kafkaCtrl.sendMessage(
        TOPICS.ADMIN_LLM_CHAT_MESSAGE_SENT,
        [{ value: {
          conversation_id: conversation.conversation_id,
          user_id: userId,
          model: modelMeta.id,
          toolCallCount,
        } }],
        'admin_llm_chat_message_sent',
      ).catch(() => {});
    }

    if (turnContextUsage) sendEvent('context_usage', turnContextUsage);

    sendEvent('done', {
      finishReason: budgetExhausted ? 'tool_budget_exhausted' : 'stop',
      content,
      trace,
      usage: {
        tokensIn: turnTokensIn,
        tokensOut: turnTokensOut,
        costUsd,
        effectiveContextTokens: effectiveTokens,
        contextLimit,
        contextPct,
      },
      contextUsage: turnContextUsage,
      resumeHint: budgetExhausted
        ? {
          reason: 'TOOL_BUDGET_EXHAUSTED',
          maxToolsPerTurn: maxTools,
          toolCallsUsed: toolCallCount,
          suggestedPrompt: 'Continue the analysis. Use the remaining tools to finish what you were doing.',
        }
        : null,
    });

    const isFirstTurn = history.filter((m) => m.role === 'assistant' && m.finish_reason === 'stop').length === 0;
    if (isFirstTurn && content) {
      try {
        const title = await titleService.generateTitle(conversation, userMessage.content, content, userId);
        if (title) {
          await titleService.applyTitle(conversation.conversation_id, userId, title);
          sendEvent('title_updated', { conversationId: conversation.conversation_id, title });
          if (global.kafkaProducer) {
            kafkaCtrl.sendMessage(
              TOPICS.ADMIN_LLM_CHAT_TITLE_GENERATED,
              [{ value: { conversation_id: conversation.conversation_id, user_id: userId, title } }],
              'admin_llm_chat_title_generated',
            ).catch(() => {});
          }
        }
      } catch (err) {
        logger.warn('admin_llm_chat title failed', { err: err.message });
      }
    }
  } catch (error) {
    const partial = traceBuilder.finalize();
    const partialText = String(partial.content || '').trim();
    const hasPartial = partialText.length > 0 || (partial.trace || []).some((s) => s.type === 'tool');

    if (signal?.aborted) {
      logger.info('admin_llm_chat stream aborted', {
        conversationId: conversation.conversation_id,
        userId,
      });
      await MessageModel.finalize(assistantMsgId, {
        content: partial.content || '',
        content_parts: partial.content_parts,
        finish_reason: partialText.length || hasPartial ? 'aborted' : 'interrupted',
        tokens_in: turnTokensIn,
        tokens_out: turnTokensOut,
        cost_usd: estimateCost(modelMeta, turnTokensIn, turnTokensOut),
        latency_ms: Date.now() - startedAt,
      });
      sendEvent('done', {
        finishReason: 'aborted',
        content: partial.content,
        trace: partial.trace,
      });
      return;
    }

    const rawMsg = String(error?.message || '');
    const streamDropped = /terminated|econnreset|socket hang up/i.test(rawMsg);
    if (streamDropped && hasPartial) {
      logger.warn('admin_llm_chat stream disconnected with partial output', {
        conversationId: conversation.conversation_id,
        userId,
        raw: rawMsg,
      });
      await MessageModel.finalize(assistantMsgId, {
        content: partial.content || '',
        content_parts: partial.content_parts,
        finish_reason: 'stop',
        tokens_in: turnTokensIn,
        tokens_out: turnTokensOut,
        cost_usd: estimateCost(modelMeta, turnTokensIn, turnTokensOut),
        latency_ms: Date.now() - startedAt,
      });
      sendEvent('done', {
        finishReason: 'aborted',
        content: partial.content,
        trace: partial.trace,
      });
      return;
    }

    const formatted = formatProviderError(error);
    logger.error('admin-llm-chat stream error', {
      code: formatted.code,
      message: formatted.message,
      raw: error.message,
    });
    const partialContent = String(partial.content || '').trim();
    await MessageModel.finalize(assistantMsgId, {
      content: partialContent || (hasPartial ? '' : '(failed)'),
      content_parts: partial.content_parts,
      finish_reason: 'error',
      tokens_in: turnTokensIn,
      tokens_out: turnTokensOut,
      cost_usd: estimateCost(modelMeta, turnTokensIn, turnTokensOut),
      latency_ms: Date.now() - startedAt,
    });
    sendEvent('error', formatted);
    sendEvent('done', { finishReason: 'error', trace: partial.trace });
  } finally {
    // Safety net: if no handler finalized this row (unexpected throw/early exit),
    // close it atomically. Conditional on master so a completed row is never clobbered.
    await MessageModel.finalizeIfInProgress(assistantMsgId).catch(() => {});
  }
}

module.exports = { runStreamingTurn };

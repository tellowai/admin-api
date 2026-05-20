'use strict';

const { v4: uuidv4 } = require('uuid');
const LLMProviderFactory = require('../../ai-services/factories/llm.provider.factory');
const { TOOL_DEFINITIONS, toOpenAITools, toAnthropicTools } = require('../constants/tool.registry');
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
const titleService = require('./conversation.title.service');
const { formatProviderError } = require('./provider-error.util');
const { redactValue, truncatePreview } = require('./pii.redactor');
const logger = require('../../../config/lib/logger');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');

function estimateCost(modelMeta, tokensIn, tokensOut) {
  return ((tokensIn / 1e6) * modelMeta.inputCostPer1M + (tokensOut / 1e6) * modelMeta.outputCostPer1M);
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
    if (this.currentKind !== 'tool') this.startSegment('tool');
    const seg = this.trace[this.segmentIndex];
    if (seg) {
      seg.toolCallId = id;
      seg.name = name;
    }
  }

  onToolEnd({ id, name, arguments: args, durationMs, result }) {
    const seg = this.trace.find((s) => s.type === 'tool' && s.toolCallId === id)
      || this.trace[this.segmentIndex];
    if (seg && seg.type === 'tool') {
      seg.toolCallId = id;
      seg.name = name;
      seg.args = redactValue(args || {});
      seg.status = result?.success === false ? 'failed' : 'completed';
      seg.durationMs = durationMs;
      seg.rowsReturned = result?.rows?.length ?? null;
      seg.resultPreview = truncatePreview(redactValue(formatToolResultPreview(result)), 2048);
    }
    this.sendEvent('segment_end', { kind: 'tool', index: this.segmentIndex });
    this.currentKind = null;
  }

  finalize() {
    if (this.currentKind === 'text' && this.textBuffer) {
      this.trace[this.segmentIndex].text = this.textBuffer;
      this.sendEvent('segment_end', { kind: 'text', index: this.segmentIndex });
    }
    const textSegments = this.trace.filter((s) => s.type === 'text' && s.text);
    const finalSeg = textSegments.length ? textSegments[textSegments.length - 1] : null;
    const content = finalSeg?.text || this.textBuffer || '';
    return { trace: this.trace, content, content_parts: { trace: this.trace } };
  }
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

  if ((conversation.total_tokens_in || 0) + (conversation.total_tokens_out || 0) >= CONSTANTS.CONVERSATION_TOKEN_CAP) {
    sendEvent('error', { code: 'BUDGET_EXCEEDED', message: 'Conversation token cap reached. Start a new chat.', retryable: false });
    sendEvent('done', { finishReason: 'budget_exceeded' });
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

  let summary = await ContextSummaryModel.getLatest(conversation.conversation_id);
  const usedPct = contextSummaryService.computeUsedPct(conversation, modelMeta);
  if (contextSummaryService.shouldSummarize(conversation, modelMeta)) {
    sendEvent('context_summarizing', { reason: 'auto', usedPct });
    summary = await contextSummaryService.summarize(conversation, { userId }) || summary;
    if (summary) {
      sendEvent('context_summarized', {
        summaryId: summary.summary_id,
        throughSequenceNo: summary.through_sequence_no,
        usedPct: contextSummaryService.computeUsedPct(conversation, modelMeta),
      });
      if (global.kafkaProducer) {
        kafkaCtrl.sendMessage(
          TOPICS.ADMIN_LLM_CHAT_CONTEXT_SUMMARIZED,
          [{ value: { conversation_id: conversation.conversation_id, user_id: userId, summary_id: summary.summary_id } }],
          'admin_llm_chat_context_summarized',
        ).catch(() => {});
      }
    }
  } else if (usedPct >= CONSTANTS.CONTEXT_USAGE_WARN_PCT) {
    sendEvent('context_warning', { usedPct, limit: modelMeta.contextWindow });
  }

  const [systemText, historyPayload] = await Promise.all([
    promptService.buildSystemPrompt(userId, conversation.system_prompt_version),
    conversationData.loadMessagesWithTools(conversation.conversation_id),
  ]);
  const history = historyPayload.messages;

  const seq = await MessageModel.nextSequenceNo(conversation.conversation_id);
  const turnId = uuidv4();
  const userMsgId = uuidv4();
  const assistantMsgId = uuidv4();
  const assistantSeq = seq + 1;

  await MessageModel.createMany([
    {
      message_id: userMsgId,
      conversation_id: conversation.conversation_id,
      turn_id: turnId,
      client_message_id: userMessage.client_message_id || null,
      role: 'user',
      content: userMessage.content,
      content_parts: userMessage.content_parts || null,
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

  const historyWithUser = [
    ...history,
    { role: 'user', content: userMessage.content, sequence_no: seq },
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
  const tools = modelMeta.provider === 'anthropic' ? toAnthropicTools(TOOL_DEFINITIONS) : toOpenAITools(TOOL_DEFINITIONS);
  const traceBuilder = new TurnTraceBuilder(sendEvent);
  let toolCallCount = 0;
  const maxTools = CONSTANTS.MAX_TOOL_CALLS_PER_TURN;
  let turnTokensIn = 0;
  let turnTokensOut = 0;
  let sawToolThisRound = false;
  const turnExtraMessages = [];

  const runLoop = async ({ allowTools = true, summaryNudge = false } = {}) => {
    const activeTools = allowTools ? tools : undefined;
    const nudge = summaryNudge
      ? [{
        role: 'user',
        content: 'Based on the tool results above, answer the user in clear prose. Do not call more tools. If queries failed or tables are missing, say so and suggest next steps.',
        sequence_no: seq,
      }]
      : [];
    const baseHistory = [
      ...history,
      { role: 'user', content: userMessage.content, sequence_no: seq },
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

    await new Promise((resolve, reject) => {
      provider.streamChatCompletion({
        model: modelMeta.id,
        messages: modelMeta.provider === 'anthropic' ? messages.filter((m) => m.role !== 'system') : messages,
        system: modelMeta.provider === 'anthropic' ? messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n') : undefined,
        tools: activeTools,
        maxTokens: modelMeta.maxOutputTokens,
        signal,
        onDelta: ({ text }) => {
          sendEvent('thinking', {});
          traceBuilder.appendText(text);
          sendEvent('token', { text });
        },
        onThinking: () => sendEvent('thinking', {}),
        onToolCallStart: ({ id, name }) => {
          sawToolThisRound = true;
          pendingToolCalls.push({ id, name, arguments: {} });
          traceBuilder.onToolStart({ id, name });
          sendEvent('tool_start', { toolCallId: id, name });
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

    turnTokensIn += roundTokensIn;
    turnTokensOut += roundTokensOut;

    if (pendingToolCalls.length && toolCallCount < maxTools) {
      if (!sawToolThisRound) traceBuilder.markFinalSegment();
      const callsForRound = [...pendingToolCalls];
      const toolResults = [];
      const toolRowsToInsert = [];
      for (const tc of callsForRound) {
        toolCallCount += 1;
        const start = Date.now();
        const result = await executeTool(tc.name, tc.arguments, { userId });
        const durationMs = Date.now() - start;
        toolRowsToInsert.push({
          tool_call_id: uuidv4(),
          message_id: assistantMsgId,
          tool_name: tc.name,
          arguments_json: redactValue(tc.arguments),
          result_json: result.envelope,
          status: result.success === false ? 'failed' : 'completed',
          duration_ms: durationMs,
          rows_returned: result.rows?.length,
          error_code: result.error || null,
        });
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
        const toolContent = typeof result.envelope === 'string'
          ? result.envelope
          : JSON.stringify(result.envelope || {});
        toolResults.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: toolContent,
          content_stub: `[tool:${tc.name}]`,
        });
      }
      if (toolRowsToInsert.length) {
        await ToolCallModel.createMany(toolRowsToInsert);
      }
      pendingToolCalls.length = 0;
      const toolRoundMessages = [
        {
          role: 'assistant',
          content: null,
          model_provider: modelMeta.provider,
          tool_calls: callsForRound.map((tc) => ({
            tool_call_id: tc.id,
            tool_name: tc.name,
            arguments_json: tc.arguments,
          })),
        },
        ...toolResults,
      ];
      turnExtraMessages.push(...toolRoundMessages);
      return runLoop({ allowTools: true });
    }

    if (pendingToolCalls.length) {
      pendingToolCalls.length = 0;
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
        finish_reason: 'stop',
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
    const effectiveTokens = turnContextUsage?.effectiveTokens
      ?? ((conversation.total_tokens_in || 0) + (conversation.total_tokens_out || 0) + turnTokensIn + turnTokensOut);
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
      finishReason: 'stop',
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
    const formatted = formatProviderError(error);
    const partial = traceBuilder.finalize();
    logger.error('admin-llm-chat stream error', {
      code: formatted.code,
      message: formatted.message,
      raw: error.message,
    });
    await MessageModel.finalize(assistantMsgId, {
      content: partial.content || '(failed)',
      content_parts: partial.content_parts,
      finish_reason: 'error',
      tokens_in: turnTokensIn,
      tokens_out: turnTokensOut,
      cost_usd: estimateCost(modelMeta, turnTokensIn, turnTokensOut),
      latency_ms: Date.now() - startedAt,
    });
    sendEvent('error', formatted);
    sendEvent('done', { finishReason: 'error', trace: partial.trace });
  }
}

module.exports = { runStreamingTurn };

'use strict';

const BaseLLMProvider = require('../base.llm.provider');
const AnthropicWrapper = require('./anthropic.wrapper.cjs');
const modelsRegistry = require('../../../admin-llm-chat/services/models.registry.service');

class AnthropicProvider extends BaseLLMProvider {
  constructor(config) {
    super(config);
    this.client = null;
  }

  async initialize() {
    this.client = await AnthropicWrapper.create(this.config);
  }

  listSupportedModels() {
    return modelsRegistry.getEnabledModels().filter((m) => m.provider === 'anthropic');
  }

  async countTokens({ model, messages, system, tools }) {
    if (!this.client) await this.initialize();
    const anthropicMessages = this._toAnthropicMessages(messages);
    const result = await this.client.messages.countTokens({
      model,
      system: system || undefined,
      messages: anthropicMessages,
      tools: tools && tools.length ? tools : undefined,
    });
    return result.input_tokens;
  }

  async streamChatCompletion({
    model,
    messages,
    system,
    tools,
    maxTokens,
    temperature,
    onDelta,
    onToolCallStart,
    onToolCallDelta,
    onToolCallEnd,
    onThinking,
    onFinish,
    onError,
    signal,
  }) {
    const startTime = performance.now();
    if (!this.client) await this.initialize();

    const anthropicMessages = this._toAnthropicMessages(messages);
    const stream = this.client.messages.stream({
      model,
      max_tokens: maxTokens || 8192,
      temperature: temperature ?? 0.2,
      system: system || undefined,
      messages: anthropicMessages,
      tools: tools && tools.length ? tools : undefined,
    });

    if (signal) {
      signal.addEventListener('abort', () => stream.controller.abort());
    }

    let currentTool = null;
    let toolInputJson = '';

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            currentTool = { id: event.content_block.id, name: event.content_block.name };
            toolInputJson = '';
            onToolCallStart?.({ id: currentTool.id, name: currentTool.name, arguments: {} });
          } else if (event.content_block.type === 'thinking') {
            onThinking?.({ type: 'thinking' });
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            onDelta?.({ type: 'token', text: event.delta.text });
          } else if (event.delta.type === 'input_json_delta' && currentTool) {
            toolInputJson += event.delta.partial_json;
            onToolCallDelta?.({ id: currentTool.id, argumentsDelta: event.delta.partial_json });
          } else if (event.delta.type === 'thinking_delta') {
            onThinking?.({ type: 'thinking', text: event.delta.thinking });
          }
        } else if (event.type === 'content_block_stop' && currentTool) {
          let args = {};
          try {
            args = toolInputJson ? JSON.parse(toolInputJson) : {};
          } catch (_e) {
            args = {};
          }
          onToolCallEnd?.({ id: currentTool.id, name: currentTool.name, arguments: args });
          currentTool = null;
          toolInputJson = '';
        } else if (event.type === 'message_stop' || event.type === 'message_delta') {
          // handled after loop via finalMessage
        }
      }

      // Safety net: stream ended while a tool_use block was still open (e.g.
      // disconnect before content_block_stop) — finalize with whatever arrived.
      if (currentTool) {
        let args = {};
        try {
          args = toolInputJson ? JSON.parse(toolInputJson) : {};
        } catch (_e) {
          args = {};
        }
        onToolCallEnd?.({ id: currentTool.id, name: currentTool.name, arguments: args, rawArguments: toolInputJson });
        currentTool = null;
        toolInputJson = '';
      }

      const finalMessage = await stream.finalMessage();
      const usage = finalMessage.usage || {};
      onFinish?.({
        finishReason: finalMessage.stop_reason || 'end_turn',
        usage: {
          tokensIn: usage.input_tokens || 0,
          tokensOut: usage.output_tokens || 0,
        },
        latencyMs: Math.round(performance.now() - startTime),
      });
    } catch (error) {
      onError?.(error);
    }
  }

  _toAnthropicMessages(messages) {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: m.tool_call_id,
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              },
            ],
          };
        }
        if (m.role === 'assistant' && m.tool_calls?.length) {
          const content = [];
          if (m.content) content.push({ type: 'text', text: m.content });
          m.tool_calls.forEach((tc) => {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments || {},
            });
          });
          return { role: 'assistant', content };
        }
        if (Array.isArray(m.content)) {
          return {
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content.map((part) => {
              if (part.type === 'image_url') {
                const url = part.image_url?.url || part.url;
                if (url && /^https?:\/\//i.test(url)) {
                  return {
                    type: 'image',
                    source: { type: 'url', url },
                  };
                }
                const base64 = url?.split(',')[1];
                const media = url?.match(/data:(image\/[^;]+)/)?.[1] || 'image/jpeg';
                return {
                  type: 'image',
                  source: { type: 'base64', media_type: media, data: base64 },
                };
              }
              return { type: 'text', text: part.text || '' };
            }),
          };
        }
        return { role: m.role === 'user' ? 'user' : 'assistant', content: m.content || '' };
      });
  }

  async createChatCompletion() {
    throw new Error('Use streamChatCompletion for admin LLM chat');
  }

  async createMultiModalCompletion() {
    throw new Error('Use streamChatCompletion for admin LLM chat');
  }
}

module.exports = AnthropicProvider;

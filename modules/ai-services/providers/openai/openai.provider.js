'use strict';

const BaseLLMProvider = require('../base.llm.provider');
const OpenAIWrapper = require('./openai.wrapper.cjs');
const { handleOpenAIErrors } = require('../../../core/controllers/openai.errorhandler');
const { getActiveModelData } = require('../../controllers/active.model.selection.js');
const nlp = require('compromise');

class OpenAIProvider extends BaseLLMProvider {
  constructor(config) {
    super(config);
    this.client = null;
  }

  async initialize() {
    try {
      this.client = await OpenAIWrapper.create(this.config);
    } catch (error) {
      console.error('Failed to initialize OpenAI client:', error);
      throw error;
    }
  }

  async createChatCompletion({ messages, responseFormat }) {
    const startTime = performance.now();
    let activeModel;
    
    try {
      // Ensure client is initialized
      if (!this.client) {
        await this.initialize();
      }

      // Get model data for gpt-4-turbo which supports zod response format
      activeModel = await getActiveModelData('gpt-4o');
      
      if (activeModel.provider !== 'openai') {
        throw new Error('Active model is not an OpenAI model');
      }

      const zodResponseFormat = await OpenAIWrapper.getZodResponseFormat();

      const response = await this.client.beta.chat.completions.parse({
        model: activeModel.name,
        messages,
        response_format: responseFormat ? zodResponseFormat() : undefined,
        max_tokens: activeModel.maxTokens
      });

      const metrics = this._calculateMetrics(response, startTime, messages, activeModel);

      return {
        success: true,
        data: this._parseStructuredResponse(response.choices[0].message),
        metrics
      };
    } catch (error) {
      const metrics = this._calculateFailedMetrics(startTime, messages, activeModel, error);
      
      return {
        success: false,
        error: handleOpenAIErrors(error),
        metrics
      };
    }
  }

  async createMultiModalCompletion({ messages, responseFormat, images }) {
    const startTime = performance.now();
    let activeModel;
    
    try {
      activeModel = await getActiveModelData('gpt-4o');
      
      if (activeModel.provider !== 'openai') {
        throw new Error('Active model is not an OpenAI model');
      }

      if (!activeModel.capabilities?.includes('vision')) {
        throw new Error('Active model does not support vision capabilities');
      }

      const content = this._buildMultiModalContent(messages, images);
      const zodResponseFormat = await OpenAIWrapper.getZodResponseFormat();

      const response = await this.client.chat.completions.create({
        model: activeModel.name,
        messages: content,
        response_format: responseFormat ? zodResponseFormat() : undefined,
        max_tokens: activeModel.maxTokens
      });

      const metrics = this._calculateMetrics(response, startTime, messages, activeModel, true);

      return {
        success: true,
        data: this._parseStructuredResponse(response.choices[0].message),
        metrics
      };
    } catch (error) {
      const metrics = this._calculateFailedMetrics(startTime, messages, activeModel, error, true);
      
      return {
        success: false,
        error: handleOpenAIErrors(error),
        metrics
      };
    }
  }

  _parseStructuredResponse(message) {
    if (!message) return null;
    if (message.parsed && typeof message.parsed === 'object') {
      return message.parsed;
    }
    const content = message.content;
    if (content == null) return null;
    if (typeof content === 'object') return content;
    const text = String(content).trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (__) {
          return text;
        }
      }
      return text;
    }
  }

  _buildMultiModalContent(messages, images) {
    return messages.map(msg => {
      if (msg.role === 'user') {
        return {
          role: msg.role,
          content: [
            ...(msg.content ? [{ type: "text", text: msg.content }] : []),
            ...images.map((image) => {
              const url = typeof image === 'string' ? image : image.url;
              const detail = typeof image === 'string' ? 'low' : (image.detail || 'low');
              return {
                type: 'image_url',
                image_url: { url, detail }
              };
            })
          ]
        };
      }
      return msg;
    });
  }

  _calculateMetrics(response, startTime, messages, activeModel, isMultiModal = false) {
    const completionTime = Number(((performance.now() - startTime) / 1000).toFixed(4));
    const { inputCostPerToken, outputCostPerToken } = activeModel.costs;
    const systemPromptTokenCount = messages[0]?.role === 'system' ? nlp(messages[0].text).terms().length : 0;
    const userTextTokenCount = messages.find(m => m.role === 'user')?.text 
      ? nlp(messages.find(m => m.role === 'user').text).terms().length 
      : 0;
    const { usage } = response;

    const costInDollars = (
      (usage.prompt_tokens * inputCostPerToken) + 
      (usage.completion_tokens * outputCostPerToken)
    ).toFixed(6);

    return {
      api_provider: activeModel.provider,
      model_selected: response.model,
      system_prompt_tokens_count: systemPromptTokenCount,
      user_text_tokens_count: userTextTokenCount,
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      prompt_tokens_details: JSON.stringify(usage.prompt_tokens_details || {}),
      completion_token_details: JSON.stringify(usage.completion_tokens_details || {}),
      fingerprint: response.system_fingerprint,
      completion_time: completionTime,
      first_word_response_time: completionTime,
      cost_dollars: costInDollars,
      input_types: isMultiModal ? ['text', 'image'] : ['text'],
      request_id: response.id,
      status_code: response.response?.status || 200,
      model_version: response.model
    };
  }

  _calculateFailedMetrics(startTime, messages, activeModel, error, isMultiModal = false) {
    const completionTime = Number(((performance.now() - startTime) / 1000).toFixed(4));
    const systemPromptTokenCount = messages[0]?.role === 'system' ? nlp(messages[0].text).terms().length : 0;
    const userTextTokenCount = messages.find(m => m.role === 'user')?.text 
      ? nlp(messages.find(m => m.role === 'user').text).terms().length 
      : 0;

    return {
      api_provider: activeModel?.provider || 'openai',
      model_selected: activeModel?.name || 'unknown',
      system_prompt_tokens_count: systemPromptTokenCount,
      user_text_tokens_count: userTextTokenCount,
      completion_time: completionTime,
      first_word_response_time: completionTime,
      input_types: isMultiModal ? ['text', 'image'] : ['text'],
      status_code: error?.status || 500
    };
  }

  async createAssistantCompletion({ assistantId, message, threadId, assistantAdditionalInstructions }) {
    const startTime = performance.now();
    let activeModel;
    console.log(message,'i got m-message')
    try {
      // Ensure client is initialized
      if (!this.client) {
        await this.initialize();
      }

      activeModel = await getActiveModelData('gpt-4o');

      const existingAssistantData = await this.client.beta.assistants.retrieve(assistantId);
console.log(existingAssistantData,'-existingAssistantData')
      let finalAssistantInstructions = assistantAdditionalInstructions || '';
      if(existingAssistantData && existingAssistantData?.instructions) {
        const assistantBaseInstructions = existingAssistantData.instructions;
        finalAssistantInstructions = assistantBaseInstructions + assistantAdditionalInstructions;
      }

      // Use existing thread or create new one
      let thread;
      if (threadId) {
        try {
          // Verify thread exists
          thread = await this.client.beta.threads.retrieve(threadId);
        } catch (error) {
          // If thread doesn't exist, create new one
          thread = await this.client.beta.threads.create();
        }
      } else {
        // Create a new thread
        thread = await this.client.beta.threads.create();
      }
console.log(thread,'---thread')


      // Add message to thread
      await this.client.beta.threads.messages.create(thread.id, {
        role: "user",
        content: message
      });
console.log(message,'->message')      
      // Create and poll run
      const run = await this.client.beta.threads.runs.createAndPoll(
        thread.id,
        {
          assistant_id: assistantId,
          instructions: finalAssistantInstructions
        }
      );
console.log(run,'---run')

      let response = null;
      if (run.status === 'completed') {
        const messages = await this.client.beta.threads.messages.list(run.thread_id);
        console.log(messages,'---------#######messages######--------',messages.data[0]?.content[0])
        const messageContent = messages.data[0]?.content[0]?.text?.value;
        
        try {
          // Try to parse the response as JSON
          response = JSON.parse(messageContent);
        } catch (parseError) {
          // If parsing fails, wrap the text in our expected format
          response = messageContent;
        }
      } else {
        console.log('$$$$$$$$$$$$$$$sx')
      }
console.log('woooooohhhhhhhhh', response)
console.log('----------')
console.log({
  usage: run.usage || {},
  model: run.model,
  system_fingerprint: run.id,
  created: run.created_at,
  message,
  activeModel,
  startTime
})
      const metrics = this._calculateMetrics({
        usage: run.usage || {},
        model: run.model,
        system_fingerprint: run.id,
        created: run.created_at
      }, startTime, [{ role: 'user', content: message }], activeModel, true);

      console.log('lets return back ,,,, ', {
        success: true,
        data: response,
        metrics,
        threadId: thread.id,
        runId: run.id
      })
      return {
        success: true,
        data: response,
        metrics,
        threadId: thread.id,
        runId: run.id
      };

    } catch (error) {
      console.error(error,'ERRRRR')
      const metrics = this._calculateFailedMetrics(startTime, [{ role: 'user', content: message }], activeModel, error);
      
      return {
        success: false,
        error: handleOpenAIErrors(error),
        metrics
      };
    }
  }

  // Add helper methods for thread management
  async listThreadMessages(threadId) {
    try {
      const messages = await this.client.beta.threads.messages.list(threadId);
      return {
        success: true,
        data: messages.data
      };
    } catch (error) {
      return {
        success: false,
        error: handleOpenAIErrors(error)
      };
    }
  }

  async getRunStatus(threadId, runId) {
    try {
      const run = await this.client.beta.threads.runs.retrieve(threadId, runId);
      return {
        success: true,
        data: run
      };
    } catch (error) {
      return {
        success: false,
        error: handleOpenAIErrors(error)
      };
    }
  }

  async listRunSteps(threadId, runId) {
    try {
      const steps = await this.client.beta.threads.runs.steps.list(threadId, runId);
      return {
        success: true,
        data: steps.data
      };
    } catch (error) {
      return {
        success: false,
        error: handleOpenAIErrors(error)
      };
    }
  }

  listSupportedModels() {
    const modelsRegistry = require('../../../admin-llm-chat/services/models.registry.service');
    return modelsRegistry.getEnabledModels().filter((m) => m.provider === 'openai');
  }

  async countTokens({ model, messages }) {
    if (!this.client) await this.initialize();
    const { encoding_for_model } = require('tiktoken');
    let enc;
    try {
      enc = encoding_for_model(model.startsWith('gpt-4') ? 'gpt-4o' : 'gpt-4o');
    } catch (_e) {
      enc = encoding_for_model('gpt-4o');
    }
    let total = 0;
    messages.forEach((m) => {
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
      total += enc.encode(text).length;
    });
    enc.free();
    return total;
  }

  async streamChatCompletion({
    model,
    messages,
    tools,
    maxTokens,
    temperature,
    onDelta,
    onToolCallStart,
    onToolCallDelta,
    onToolCallEnd,
    onFinish,
    onError,
    signal,
  }) {
    const startTime = performance.now();
    if (!this.client) await this.initialize();

    const toolCallsMap = {};

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages,
        tools: tools && tools.length ? tools : undefined,
        tool_choice: tools && tools.length ? 'auto' : undefined,
        max_tokens: maxTokens || 4096,
        temperature: temperature ?? 0.2,
        stream: true,
        stream_options: { include_usage: true },
      }, { signal });

      let usage = { prompt_tokens: 0, completion_tokens: 0 };

      for await (const chunk of stream) {
        if (chunk.usage) {
          usage = chunk.usage;
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (delta?.content) {
          onDelta?.({ type: 'token', text: delta.content });
        }
        if (delta?.tool_calls) {
          delta.tool_calls.forEach((tc) => {
            const idx = tc.index ?? 0;
            if (!toolCallsMap[idx]) {
              toolCallsMap[idx] = { id: tc.id, name: tc.function?.name || '', arguments: '' };
              onToolCallStart?.({ id: toolCallsMap[idx].id, name: toolCallsMap[idx].name, arguments: {} });
            }
            if (tc.id) toolCallsMap[idx].id = tc.id;
            if (tc.function?.name) toolCallsMap[idx].name = tc.function.name;
            if (tc.function?.arguments) {
              toolCallsMap[idx].arguments += tc.function.arguments;
              onToolCallDelta?.({ id: toolCallsMap[idx].id, argumentsDelta: tc.function.arguments });
            }
          });
        }
        if (choice.finish_reason === 'tool_calls') {
          Object.values(toolCallsMap).forEach((tc) => {
            let args = {};
            try {
              args = tc.arguments ? JSON.parse(tc.arguments) : {};
            } catch (_e) {
              args = {};
            }
            onToolCallEnd?.({ id: tc.id, name: tc.name, arguments: args });
          });
        }
      }

      onFinish?.({
        finishReason: 'stop',
        usage: {
          tokensIn: usage.prompt_tokens || 0,
          tokensOut: usage.completion_tokens || 0,
        },
        latencyMs: Math.round(performance.now() - startTime),
      });
    } catch (error) {
      onError?.(error);
    }
  }
}

module.exports = OpenAIProvider;
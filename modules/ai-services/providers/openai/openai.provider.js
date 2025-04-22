'use strict';

const BaseLLMProvider = require('../base.llm.provider');
const OpenAIWrapper = require('./openai.wrapper.cjs');
const { handleOpenAIErrors } = require('../../../core/controllers/openai.errorhandler.js');
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
        response_format: zodResponseFormat(responseFormat.schema, responseFormat.schemaName),
        max_tokens: activeModel.maxTokens
      });

      const metrics = this._calculateMetrics(response, startTime, messages, activeModel);

      return {
        success: true,
        data: response.choices[0].message.parsed || response.choices[0].message.content,
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
      activeModel = await getActiveModelData();
      
      if (activeModel.provider !== 'openai') {
        throw new Error('Active model is not an OpenAI model');
      }

      if (!activeModel.capabilities?.includes('vision')) {
        throw new Error('Active model does not support vision capabilities');
      }

      const content = this._buildMultiModalContent(messages, images);

      const response = await this.client.chat.completions.create({
        model: activeModel.name,
        messages: content,
        response_format: responseFormat ? OpenAIWrapper.getZodResponseFormat()(responseFormat.schema, responseFormat.schemaName) : undefined,
        max_tokens: activeModel.maxTokens
      });

      const metrics = this._calculateMetrics(response, startTime, messages, activeModel, true);

      return {
        success: true,
        data: response.choices[0].message.parsed || response.choices[0].message.content,
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

  _buildMultiModalContent(messages, images) {
    return messages.map(msg => {
      if (msg.role === 'user') {
        return {
          role: msg.role,
          content: [
            ...(msg.content ? [{ type: "text", text: msg.content }] : []),
            ...images.map(image => ({
              type: "image_url",
              image_url: {
                url: image,
                detail: "low"
              }
            }))
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
}

module.exports = OpenAIProvider;
'use strict';

const config = require('../../../config/config');
const LLMProviderFactory = require('../../ai-services/factories/llm.provider.factory');
const { buildOpenaiTokenLimitParams } = require('../../ai-services/utils/openai.token-limit');
const { resolveAnthropicApiKey } = require('../../ai-services/providers/anthropic/anthropic.wrapper.cjs');

function hasAnthropicKey() {
  return Boolean(resolveAnthropicApiKey(config));
}

async function createAnthropicMessagesClient() {
  const AnthropicWrapper = require('../../ai-services/providers/anthropic/anthropic.wrapper.cjs');
  return AnthropicWrapper.create(config);
}

async function createOpenaiChatClient() {
  const provider = await LLMProviderFactory.createProvider('openai');
  return provider.client;
}

/** Resolve configured summarizer; OpenAI mini fallback if Anthropic unavailable. */
function resolveAuxiliaryModel(summarizer) {
  if (summarizer?.provider === 'openai') {
    return { provider: 'openai', id: summarizer.id || 'gpt-4o-mini' };
  }
  if (summarizer?.provider === 'anthropic' && hasAnthropicKey()) {
    return { provider: 'anthropic', id: summarizer.id };
  }
  return { provider: 'openai', id: 'gpt-4o-mini' };
}

async function completeShortText({ summarizer, system, userContent, maxTokens }) {
  const model = resolveAuxiliaryModel(summarizer);
  if (model.provider === 'anthropic') {
    const client = await createAnthropicMessagesClient();
    const resp = await client.messages.create({
      model: model.id,
      max_tokens: maxTokens,
      system: system || undefined,
      messages: [{ role: 'user', content: userContent }],
    });
    const text = resp.content?.filter((b) => b.type === 'text').map((b) => b.text).join('') || '';
    return {
      text,
      promptTokens: resp.usage?.input_tokens || 0,
      completionTokens: resp.usage?.output_tokens || 0,
    };
  }
  const client = await createOpenaiChatClient();
  const messages = system
    ? [{ role: 'system', content: system }, { role: 'user', content: userContent }]
    : [{ role: 'user', content: userContent }];
  const resp = await client.chat.completions.create({
    model: model.id,
    ...buildOpenaiTokenLimitParams(model.id, maxTokens),
    messages,
  });
  return {
    text: resp.choices?.[0]?.message?.content || '',
    promptTokens: resp.usage?.prompt_tokens || 0,
    completionTokens: resp.usage?.completion_tokens || 0,
  };
}

module.exports = {
  hasAnthropicKey,
  resolveAuxiliaryModel,
  completeShortText,
  createOpenaiChatClient,
};

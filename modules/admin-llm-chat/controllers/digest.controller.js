'use strict';

const { v4: uuidv4 } = require('uuid');
const HTTP = require('../../core/controllers/httpcodes.server.controller').CODES;
const ConversationModel = require('../models/conversation.model');
const MessageModel = require('../models/message.model');
const telegramService = require('../services/telegram.service');
const promptService = require('../services/prompt.service');
const orchestrator = require('../services/admin-llm-chat.orchestrator.service');
const CONSTANTS = require('../constants/admin-llm-chat.constants');
const modelsRegistry = require('../services/models.registry.service');
const logger = require('../../../config/lib/logger');

const sentDigests = new Set();

async function resolveDigestText(convId, tokenParts, doneContent) {
  const fromDone = String(doneContent || '').trim();
  if (fromDone) return fromDone;

  const fromTokens = tokenParts.join('').trim();
  if (fromTokens) return fromTokens;

  const rows = await MessageModel.listByConversation(convId);
  const assistant = [...rows].reverse().find((m) => m.role === 'assistant' && String(m.content || '').trim());
  return assistant ? String(assistant.content).trim() : '';
}

exports.runDigest = async (req, res) => {
  const dateKey = req.body.date || new Date().toISOString().slice(0, 10);
  if (sentDigests.has(dateKey)) {
    return res.status(HTTP.CONFLICT).json({ code: 'DIGEST_ALREADY_SENT' });
  }

  const systemUserId = CONSTANTS.DIGEST_SYSTEM_USER_ID;
  const convId = uuidv4();
  const fallbackId = CONSTANTS.DIGEST_FALLBACK_MODEL;
  const model =
    modelsRegistry.findModel(fallbackId, 'openai')
    || modelsRegistry.findModel(fallbackId, 'anthropic')
    || modelsRegistry.getDefaultModel();
  if (!model) {
    return res.status(HTTP.SERVICE_UNAVAILABLE).json({ code: 'MODEL_NOT_CONFIGURED' });
  }

  try {
    await ConversationModel.create({
      conversation_id: convId,
      user_id: systemUserId,
      title: `Daily Digest ${dateKey}`,
      model_provider: model.provider,
      model_id: model.id,
      system_prompt_version: CONSTANTS.DEFAULT_SYSTEM_PROMPT_VERSION,
    });

    const digestPrompt = `Produce the daily marketing intelligence digest for ${dateKey}. Compare yesterday vs trailing 7 days and 28 days for Meta Ads, Google Ads, and internal analytics. Output: ${CONSTANTS.DIGEST_OUTPUT_SECTIONS}.`;

    const tokenParts = [];
    let doneContent = '';
    const mockRes = {
      write: () => {},
      end: () => {},
      on: () => {},
      setHeader: () => {},
      flushHeaders: () => {},
    };
    const sendEvent = (event, data) => {
      if (event === 'token' && data?.text) tokenParts.push(data.text);
      if (event === 'done' && typeof data?.content === 'string') doneContent = data.content;
    };

    await orchestrator.runStreamingTurn({
      conversation: {
        conversation_id: convId,
        model_provider: model.provider,
        model_id: model.id,
        system_prompt_version: CONSTANTS.DEFAULT_SYSTEM_PROMPT_VERSION,
        total_tokens_in: 0,
        total_tokens_out: 0,
      },
      modelMeta: model,
      userId: systemUserId,
      userMessage: { content: digestPrompt },
      res: mockRes,
      sendEvent,
      signal: undefined,
    });

    const text = await resolveDigestText(convId, tokenParts, doneContent);
    if (!text) {
      logger.error('[admin-llm-chat] Digest produced no assistant text', { conversationId: convId, dateKey });
      return res.status(HTTP.SERVICE_UNAVAILABLE).json({ code: 'DIGEST_EMPTY' });
    }

    await telegramService.sendMessage(text, null);
    sentDigests.add(dateKey);

    return res.status(HTTP.OK).json({ data: { conversation_id: convId, sent: true } });
  } catch (err) {
    logger.error('[admin-llm-chat] Digest failed', {
      conversationId: convId,
      dateKey,
      message: err.message,
      responseData: err.response?.data,
    });
    return res.status(HTTP.INTERNAL_SERVER_ERROR).json({
      code: 'DIGEST_FAILED',
      message: err.message,
    });
  }
};

exports.getBusinessContext = async (req, res) => {
  return res.status(HTTP.OK).json({ data: promptService.loadBusinessContext() });
};

exports.patchBusinessContext = async (req, res) => {
  const before = promptService.loadBusinessContext();
  promptService.saveBusinessContext(req.validatedBody);
  return res.status(HTTP.OK).json({ data: req.validatedBody });
};

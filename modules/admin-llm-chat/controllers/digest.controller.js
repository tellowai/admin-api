'use strict';

const { v4: uuidv4 } = require('uuid');
const HTTP = require('../../core/controllers/httpcodes.server.controller').CODES;
const ConversationModel = require('../models/conversation.model');
const telegramService = require('../services/telegram.service');
const promptService = require('../services/prompt.service');
const orchestrator = require('../services/admin-llm-chat.orchestrator.service');
const CONSTANTS = require('../constants/admin-llm-chat.constants');
const modelsRegistry = require('../services/models.registry.service');

const sentDigests = new Set();

exports.runDigest = async (req, res) => {
  const dateKey = req.body.date || new Date().toISOString().slice(0, 10);
  if (sentDigests.has(dateKey)) {
    return res.status(HTTP.CONFLICT).json({ code: 'DIGEST_ALREADY_SENT' });
  }

  const systemUserId = 'system-digest';
  const convId = uuidv4();
  const fallbackId = CONSTANTS.DIGEST_FALLBACK_MODEL;
  const model =
    modelsRegistry.findModel(fallbackId, 'openai')
    || modelsRegistry.findModel(fallbackId, 'anthropic')
    || modelsRegistry.getDefaultModel();
  if (!model) {
    return res.status(HTTP.SERVICE_UNAVAILABLE).json({ code: 'MODEL_NOT_CONFIGURED' });
  }

  await ConversationModel.create({
    conversation_id: convId,
    user_id: systemUserId,
    title: `Daily Digest ${dateKey}`,
    model_provider: model.provider,
    model_id: model.id,
    system_prompt_version: CONSTANTS.DEFAULT_SYSTEM_PROMPT_VERSION,
  });

  const digestPrompt = `Produce the daily marketing intelligence digest for ${dateKey}. Compare yesterday vs trailing 7 days and 28 days for Meta Ads, Google Ads, and internal analytics. Output: TL;DR (3 bullets), Numbers, Anomalies, Suggested actions.`;

  const events = [];
  const mockRes = {
    write: () => {},
    end: () => {},
    on: () => {},
    setHeader: () => {},
    flushHeaders: () => {},
  };
  const sendEvent = (event, data) => {
    if (event === 'token') events.push(data.text);
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

  const text = events.join('');
  await telegramService.sendMessage(text, null);
  sentDigests.add(dateKey);

  return res.status(HTTP.OK).json({ data: { conversation_id: convId, sent: true } });
};

exports.getBusinessContext = async (req, res) => {
  return res.status(HTTP.OK).json({ data: promptService.loadBusinessContext() });
};

exports.patchBusinessContext = async (req, res) => {
  const before = promptService.loadBusinessContext();
  promptService.saveBusinessContext(req.validatedBody);
  return res.status(HTTP.OK).json({ data: req.validatedBody });
};

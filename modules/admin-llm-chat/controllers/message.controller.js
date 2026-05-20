'use strict';

const HTTP = require('../../core/controllers/httpcodes.server.controller').CODES;
const ConversationModel = require('../models/conversation.model');
const AttachmentModel = require('../models/attachment.model');
const sseService = require('../services/sse.service');
const orchestrator = require('../services/admin-llm-chat.orchestrator.service');
const streamRegistry = require('../services/stream.registry');
const modelsRegistry = require('../services/models.registry.service');
const ERROR_CODES = require('../constants/error.codes');
const CONSTANTS = require('../constants/admin-llm-chat.constants');

function resolveTurnModel(body, conv) {
  if (body.model_id && body.model_provider) {
    const model = modelsRegistry.getEnabledModels().find(
      (m) => m.id === body.model_id && m.provider === body.model_provider,
    );
    return model || null;
  }
  return modelsRegistry.resolveModel(conv.model_id, conv.model_provider);
}

exports.streamMessage = async (req, res) => {
  const { conversationId } = req.params;
  const body = req.validatedBody;
  const userId = req.user.userId;

  if (body.content && body.content.length > 100000) {
    const err = ERROR_CODES.PAYLOAD_TOO_LARGE;
    return res.status(err.httpStatus).json({ code: err.code, message: 'Message too large' });
  }

  const conv = await ConversationModel.getByIdForUser(conversationId, userId);
  if (!conv) {
    return res.status(HTTP.NOT_FOUND).json({ code: 'CONVERSATION_NOT_FOUND' });
  }

  if (streamRegistry.hasActive(userId, conversationId)) {
    const err = ERROR_CODES.STREAM_IN_PROGRESS;
    return res.status(err.httpStatus).json({ code: err.code, retryable: err.retryable });
  }

  if (streamRegistry.isDraining()) {
    const err = ERROR_CODES.SERVER_DRAINING;
    return res.status(err.httpStatus).json({ code: err.code, retryable: err.retryable });
  }

  const modelMeta = resolveTurnModel(body, conv);
  if (!modelMeta) {
    const err = ERROR_CODES.UNSUPPORTED_MODEL;
    return res.status(err.httpStatus).json({ code: err.code, message: 'Model is not configured or provider is disabled' });
  }

  if (body.model_id && body.model_provider
    && (conv.model_id !== modelMeta.id || conv.model_provider !== modelMeta.provider)) {
    const prevProvider = conv.model_provider;
    const prevModelId = conv.model_id;
    await ConversationModel.updateModel(conversationId, userId, modelMeta.provider, modelMeta.id);
    conv.model_provider = modelMeta.provider;
    conv.model_id = modelMeta.id;
    const logger = require('../../../config/lib/logger');
    logger.info('admin_llm_chat model_switched', {
      conversationId,
      userId,
      from: { provider: prevProvider, modelId: prevModelId },
      to: { provider: modelMeta.provider, modelId: modelMeta.id },
    });
    if (global.kafkaProducer) {
      const kafkaCtrl = require('../../core/controllers/kafka.controller');
      const { TOPICS } = require('../../core/constants/kafka.events.config');
      kafkaCtrl.sendMessage(
        TOPICS.ADMIN_LLM_CHAT_MODEL_SWITCHED,
        [{ value: { conversation_id: conversationId, user_id: userId, model_id: modelMeta.id, model_provider: modelMeta.provider } }],
        'admin_llm_chat_model_switched',
      ).catch(() => {});
    }
  }

  sseService.initSse(res);
  const sendEvent = (event, data) => sseService.sendEvent(res, event, data);
  const abortController = new AbortController();
  streamRegistry.register(userId, conversationId, abortController);

  sseService.startHeartbeat(res, () => {
    abortController.abort();
    streamRegistry.unregister(userId, conversationId);
  });

  if (body.attachment_ids?.length) {
    await AttachmentModel.linkToMessage(body.attachment_ids, null);
  }

  try {
    await orchestrator.runStreamingTurn({
      conversation: conv,
      userId,
      modelMeta,
      userMessage: {
        content: body.content,
        content_parts: body.content_parts,
        client_message_id: body.client_message_id,
      },
      attachmentIds: body.attachment_ids,
      res,
      sendEvent,
      signal: abortController.signal,
    });
  } finally {
    streamRegistry.unregister(userId, conversationId);
    res.end();
  }
};

exports.abortStream = async (req, res) => {
  const ctrl = streamRegistry.get(req.user.userId, req.params.conversationId);
  if (ctrl) ctrl.abort();
  streamRegistry.unregister(req.user.userId, req.params.conversationId);
  return res.status(HTTP.OK).json({ data: { aborted: true } });
};

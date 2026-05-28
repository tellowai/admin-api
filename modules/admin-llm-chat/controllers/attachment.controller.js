'use strict';

const { v4: uuidv4 } = require('uuid');
const HTTP = require('../../core/controllers/httpcodes.server.controller').CODES;
const ConversationModel = require('../models/conversation.model');
const AttachmentModel = require('../models/attachment.model');
const parserService = require('../services/attachment.parser.service');
const attachmentStorage = require('../services/attachment.storage.service');
const CONSTANTS = require('../constants/admin-llm-chat.constants');

exports.presignAttachment = async (req, res) => {
  const body = req.validatedBody;
  const conv = await ConversationModel.getByIdForUser(body.conversation_id, req.user.userId);
  if (!conv) return res.status(HTTP.NOT_FOUND).json({ code: 'CONVERSATION_NOT_FOUND' });

  const isImage = (body.contentType || '').startsWith('image/');
  const maxSize = isImage ? CONSTANTS.MAX_FILE_SIZE_BYTES_IMAGE : CONSTANTS.MAX_FILE_SIZE_BYTES_DOC;
  if (body.size_bytes != null && body.size_bytes > maxSize) {
    return res.status(HTTP.REQUEST_ENTITY_TOO_LARGE).json({ code: 'FILE_TOO_LARGE' });
  }

  const attachmentId = uuidv4();
  const slot = await attachmentStorage.presignPublicUpload({
    conversationId: body.conversation_id,
    attachmentId,
    contentType: body.contentType,
    extension: body.extension,
  });

  return res.status(HTTP.OK).json({
    data: {
      attachment_id: attachmentId,
      storage_key: slot.storage_key,
      signed_url: slot.signed_url,
      public_url: slot.public_url,
      bucket: slot.bucket,
    },
  });
};

exports.registerAttachment = async (req, res) => {
  const body = req.validatedBody;
  const conv = await ConversationModel.getByIdForUser(body.conversation_id, req.user.userId);
  if (!conv) return res.status(HTTP.NOT_FOUND).json({ code: 'CONVERSATION_NOT_FOUND' });

  if (!attachmentStorage.isAllowedStorageKey(body.storage_key, {
    conversationId: body.conversation_id,
    attachmentId: body.attachment_id,
  })) {
    return res.status(HTTP.BAD_REQUEST).json({
      code: 'INVALID_STORAGE_KEY',
      message: 'storage_key must be under admin-llm-chat/attachments for this conversation and attachment',
    });
  }

  const isImage = (body.mime_type || '').startsWith('image/');
  const maxSize = isImage ? CONSTANTS.MAX_FILE_SIZE_BYTES_IMAGE : CONSTANTS.MAX_FILE_SIZE_BYTES_DOC;
  if (body.size_bytes > maxSize) {
    return res.status(HTTP.REQUEST_ENTITY_TOO_LARGE).json({ code: 'FILE_TOO_LARGE' });
  }

  const existing = await AttachmentModel.getByIdForUser(body.attachment_id, req.user.userId);
  if (existing) {
    return res.status(HTTP.CONFLICT).json({ code: 'ATTACHMENT_ALREADY_REGISTERED' });
  }

  await AttachmentModel.create({
    attachment_id: body.attachment_id,
    conversation_id: body.conversation_id,
    user_id: req.user.userId,
    mime_type: body.mime_type,
    size_bytes: body.size_bytes,
    storage_key: body.storage_key.replace(/^\/+/, ''),
    original_name: body.original_name,
    parse_status: 'pending',
  });
  return res.status(HTTP.CREATED).json({
    data: { attachment_id: body.attachment_id, parse_status: 'pending', public_url: body.public_url || null },
  });
};

exports.parseAttachment = async (req, res) => {
  const att = await AttachmentModel.getByIdForUser(req.params.attachmentId, req.user.userId);
  if (!att) return res.status(HTTP.NOT_FOUND).json({ message: 'Not found' });

  const mime = att.mime_type || '';
  let parsed = null;
  let status = 'completed';

  try {
    const buffer = await attachmentStorage.fetchPublicObjectBuffer(att.storage_key);

    if (mime === 'text/csv' || mime.includes('csv')) {
      parsed = await parserService.parseCsv(buffer);
    } else if (mime.includes('spreadsheet') || mime.includes('excel') || att.original_name?.endsWith('.xlsx')) {
      parsed = await parserService.parseXlsx(buffer);
    } else if (mime === 'application/pdf') {
      const pdf = await parserService.parsePdf(buffer);
      parsed = pdf.text;
      status = pdf.status;
    } else if (mime.startsWith('image/')) {
      status = 'no_text';
    }
  } catch (err) {
    return res.status(HTTP.BAD_REQUEST).json({
      code: 'PARSE_FAILED',
      message: err.message || 'Could not read attachment from storage',
    });
  }

  if (parsed != null || status !== 'completed') {
    await AttachmentModel.updateParse(req.params.attachmentId, parsed, status);
  }
  return res.status(HTTP.OK).json({ data: { attachment_id: req.params.attachmentId, parse_status: status } });
};

'use strict';

const { v4: uuidv4 } = require('uuid');
const HTTP = require('../../core/controllers/httpcodes.server.controller').CODES;
const ConversationModel = require('../models/conversation.model');
const AttachmentModel = require('../models/attachment.model');
const parserService = require('../services/attachment.parser.service');
const CONSTANTS = require('../constants/admin-llm-chat.constants');

exports.registerAttachment = async (req, res) => {
  const body = req.validatedBody;
  const conv = await ConversationModel.getByIdForUser(body.conversation_id, req.user.userId);
  if (!conv) return res.status(HTTP.NOT_FOUND).json({ code: 'CONVERSATION_NOT_FOUND' });

  const isImage = (body.mime_type || '').startsWith('image/');
  const maxSize = isImage ? CONSTANTS.MAX_FILE_SIZE_BYTES_IMAGE : CONSTANTS.MAX_FILE_SIZE_BYTES_DOC;
  if (body.size_bytes > maxSize) {
    return res.status(HTTP.REQUEST_ENTITY_TOO_LARGE).json({ code: 'FILE_TOO_LARGE' });
  }

  const attachmentId = uuidv4();
  await AttachmentModel.create({
    attachment_id: attachmentId,
    conversation_id: body.conversation_id,
    user_id: req.user.userId,
    mime_type: body.mime_type,
    size_bytes: body.size_bytes,
    storage_key: body.storage_key,
    original_name: body.original_name,
    parse_status: 'pending',
  });
  return res.status(HTTP.CREATED).json({
    data: { attachment_id: attachmentId, parse_status: 'pending' },
  });
};

exports.parseAttachment = async (req, res) => {
  const att = await AttachmentModel.getByIdForUser(req.params.attachmentId, req.user.userId);
  if (!att) return res.status(HTTP.NOT_FOUND).json({ message: 'Not found' });

  const mime = att.mime_type || '';
  let parsed = null;
  let status = 'completed';

  if (mime === 'text/csv' || mime.includes('csv')) {
    parsed = await parserService.parseCsv(Buffer.from(att.parsed_text || '', 'utf8'));
  } else if (mime.includes('spreadsheet') || mime.includes('excel') || att.original_name?.endsWith('.xlsx')) {
    parsed = 'Parse after download from storage — register with pre-parsed text in v1 follow-up';
    status = 'pending';
  } else if (mime === 'application/pdf') {
    status = 'no_text';
    parsed = null;
  }

  if (parsed) {
    await AttachmentModel.updateParse(req.params.attachmentId, parsed, status);
  }
  return res.status(HTTP.OK).json({ data: { attachment_id: req.params.attachmentId, parse_status: status } });
};

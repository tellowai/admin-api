'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const PermissionMiddleware = require('../../auth/middlewares/permission.middleware');
const ChatMiddleware = require('../middlewares/admin-llm-chat.middleware');
const DigestHmac = require('../middlewares/digest-hmac.middleware');
const CONSTANTS = require('../constants/admin-llm-chat.constants');
const ConversationCtrl = require('../controllers/conversation.controller');
const MessageCtrl = require('../controllers/message.controller');
const AttachmentCtrl = require('../controllers/attachment.controller');
const DigestCtrl = require('../controllers/digest.controller');
const HealthCtrl = require('../controllers/health.controller');
const ComplianceCtrl = require('../controllers/compliance.controller');
const Validator = require('../validators/admin-llm-chat.validator');

const perm = PermissionMiddleware.hasPermission(CONSTANTS.PERMISSION_CODE);
const admin = AuthMiddleware.isAdminUser;
const prefix = versionConfig.routePrefix + '/admin/llm-chat';

module.exports = function (app) {
  app.get(prefix + '/healthz', HealthCtrl.health);

  app.get(prefix + '/models', admin, perm, ChatMiddleware.requireEnabled, ConversationCtrl.listModels);

  app.get(prefix + '/conversations', admin, perm, ChatMiddleware.requireEnabled, ConversationCtrl.listConversations);
  app.post(prefix + '/conversations', admin, perm, ChatMiddleware.requireEnabled, Validator.validateCreateConversation, ConversationCtrl.createConversation);
  app.get(prefix + '/conversations/search', admin, perm, ChatMiddleware.requireEnabled, ConversationCtrl.searchConversations);
  app.get(prefix + '/conversations/:conversationId', admin, perm, ChatMiddleware.requireEnabled, ConversationCtrl.getConversation);
  app.patch(prefix + '/conversations/:conversationId', admin, perm, ChatMiddleware.requireEnabled, Validator.validatePatchConversation, ConversationCtrl.patchConversation);
  app.delete(prefix + '/conversations/:conversationId', admin, perm, ChatMiddleware.requireEnabled, ConversationCtrl.deleteConversation);
  app.get(prefix + '/conversations/:conversationId/export', admin, perm, ChatMiddleware.requireEnabled, ConversationCtrl.exportConversation);

  app.post(prefix + '/conversations/:conversationId/messages/stream', admin, perm, ChatMiddleware.requireEnabled, Validator.validateStreamMessage, MessageCtrl.streamMessage);
  app.delete(prefix + '/conversations/:conversationId/stream', admin, perm, ChatMiddleware.requireEnabled, MessageCtrl.abortStream);

  app.post(prefix + '/attachments/presign', admin, perm, ChatMiddleware.requireEnabled, Validator.validatePresignAttachment, AttachmentCtrl.presignAttachment);
  app.post(prefix + '/attachments', admin, perm, ChatMiddleware.requireEnabled, Validator.validateRegisterAttachment, AttachmentCtrl.registerAttachment);
  app.post(prefix + '/attachments/:attachmentId/parse', admin, perm, ChatMiddleware.requireEnabled, AttachmentCtrl.parseAttachment);

  app.get(prefix + '/business-context', admin, perm, ChatMiddleware.requireEnabled, DigestCtrl.getBusinessContext);
  app.patch(prefix + '/business-context', admin, perm, ChatMiddleware.requireEnabled, Validator.validateBusinessContext, DigestCtrl.patchBusinessContext);

  app.post(prefix + '/internal/digest', DigestHmac.verifyDigestHmac, Validator.validateDigest, DigestCtrl.runDigest);

  app.delete(prefix + '/users/:userId/data', admin, perm, ChatMiddleware.requireEnabled, ComplianceCtrl.purgeUserLlmChat);
};

'use strict';

const HTTP = require('../../core/controllers/httpcodes.server.controller').CODES;
const mysqlModel = require('../../core/models/mysql.promise.model');
const CONSTANTS = require('../constants/admin-llm-chat.constants');
const RbacModel = require('../../auth/models/rbac.model');
const { ROLES } = require('../../auth/constants/permissions.constants');

/** Hard-delete all LLM chat data for a user (GDPR). Owner-only. */
exports.purgeUserLlmChat = async (req, res) => {
  const roles = await RbacModel.getUserRoles(req.user.userId);
  if (!roles.some((r) => r.role_name === ROLES.OWNER)) {
    return res.status(HTTP.FORBIDDEN).json({ code: 'FORBIDDEN' });
  }
  const targetUserId = req.params.userId;
  const graceDays = CONSTANTS.DELETE_GRACE_DAYS;
  await mysqlModel.runQueryInMaster(
    `DELETE FROM admin_llm_chat_conversations
     WHERE user_id = ? AND deleted_at IS NOT NULL
     AND deleted_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [targetUserId, graceDays],
  );
  await mysqlModel.runQueryInMaster(
    `UPDATE admin_llm_chat_conversations SET deleted_at = NOW() WHERE user_id = ? AND deleted_at IS NULL`,
    [targetUserId],
  );
  return res.status(HTTP.OK).json({ data: { user_id: targetUserId, scheduled: true } });
};

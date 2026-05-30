'use strict';

const HTTP_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const RbacModel = require('../../auth/models/rbac.model');

function resolveUserId(user) {
  return user?.userId || user?.user_id || null;
}

function jwtIndicatesPanelAccess(user) {
  if (!user) return false;
  if (user.isAdmin === true) return true;
  if (Array.isArray(user.roles) && user.roles.length > 0) return true;
  if (Array.isArray(user.permissions) && user.permissions.length > 0) return true;
  return false;
}

/**
 * After isAuthorizedJWT: allow owner, admin, editor — any admin_user_role row.
 */
exports.requirePanelAccess = async function requirePanelAccess(req, res, next) {
  const userId = resolveUserId(req.user);
  if (!userId) {
    return res.status(HTTP_CODES.UNAUTHORIZED).json({
      message: req.t('UNAUTHORIZED'),
    });
  }

  if (jwtIndicatesPanelAccess(req.user)) {
    return next();
  }

  try {
    const roles = await RbacModel.getUserRoles(userId);
    if (roles && roles.length > 0) {
      req.user = Object.assign({}, req.user, {
        userId,
        isAdmin: true,
        roles: roles.map((r) => r.role_name),
      });
      return next();
    }

    return res.status(HTTP_CODES.UNAUTHORIZED).json({
      message: req.t('user:NOT_AN_ADMIN'),
      code: 'NOT_AN_ADMIN',
    });
  } catch (error) {
    return res.status(HTTP_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('PERMISSION_CHECK_FAILED') || 'Failed to verify access',
    });
  }
};

'use strict';

/**
 * Admin grants — Owner-only, defense-in-depth pipeline:
 *   isAdminUser  -> isOwner()  -> controller (which adds reason+idempotency validation +
 *                                              per-admin daily-cap reservation + proxy).
 *
 * `isOwner()` is a factory; remember the parens.
 */

const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const PermissionMiddleware = require('../../auth/middlewares/permission.middleware');
const AdminGrantsCtrl = require('../controllers/admin-grants.controller');

module.exports = function (app) {
  app
    .route('/admin/users/:userId/grants/credits')
    .post(AuthMiddleware.isAdminUser, PermissionMiddleware.isOwner(), AdminGrantsCtrl.grantCredits);

  app
    .route('/admin/users/:userId/grants/template-entitlement')
    .post(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.isOwner(),
      AdminGrantsCtrl.grantTemplateEntitlement
    );

  app
    .route('/admin/users/:userId/grants/pack-entitlement')
    .post(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.isOwner(),
      AdminGrantsCtrl.grantPackEntitlement
    );

  // Read-only "what's my remaining quota today" — used by UI to display caps in the modal.
  app
    .route('/admin/users/grants/daily-usage')
    .get(AuthMiddleware.isAdminUser, PermissionMiddleware.isOwner(), AdminGrantsCtrl.getDailyUsage);
};

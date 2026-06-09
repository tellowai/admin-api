'use strict';
const versionConfig = require('../../version');
const AdminUserCtrl = require('../controllers/admin.user.controller');
var AuthMiddleware = require('../../auth/middlewares/auth.middleware');
var AdminUserValidator = require('../validators/admin.user.validator');
const PermissionMiddleware = require('../../auth/middlewares/permission.middleware');


module.exports = function (app) {
  
  // Create admin user - only owner or admin can do this (editor cannot)
  // Admin can only assign 'editor' role (checked in controller)
  app.route(
    versionConfig.routePrefix +
    "/admin/users"
  ).post(  
    AuthMiddleware.isAdminUser,
    PermissionMiddleware.isOwnerOrAdmin(),
    AdminUserValidator.validateCreateAdminUserData,
    AdminUserCtrl.createNewAdminUserWithSelectRoles
  );

  // Delete single admin user - only owner or admin can do this
  app.route(
    versionConfig.routePrefix +
    "/admin/users/:userId"
  ).delete(  
    AuthMiddleware.isAdminUser,
    PermissionMiddleware.isOwnerOrAdmin(),
    AdminUserCtrl.deleteAdminUser
  );

  // Bulk delete admin users - only owner or admin can do this
  app.route(
    versionConfig.routePrefix +
    "/admin/users"
  ).delete(  
    AuthMiddleware.isAdminUser,
    PermissionMiddleware.isOwnerOrAdmin(),
    AdminUserValidator.validateBulkRemoveAdminUserData,
    AdminUserCtrl.bulkRemoveAdminUsers
  );

  // List admin users - only owner or admin can view
  app.route(
    versionConfig.routePrefix +
    "/admin/users"
  ).get(  
    AuthMiddleware.isAdminUser,
    PermissionMiddleware.isOwnerOrAdmin(),
    AdminUserCtrl.getAdminUsersList
  );

  // Search users (to add as admin) - only owner or admin can search
  app.route(
    versionConfig.routePrefix +
    "/users/search"
  ).get(  
    AuthMiddleware.isAdminUser,
    PermissionMiddleware.isOwnerOrAdmin(),
    AdminUserCtrl.searchAdminUsersByEmail
  );

  // Update admin user roles - only owner or admin can do this
  // Admin can only assign 'editor' role (checked in controller)
  app.route(
    versionConfig.routePrefix +
    "/admin/users/:userId/roles"
  ).put(  
    AuthMiddleware.isAdminUser,
    PermissionMiddleware.isOwnerOrAdmin(),
    AdminUserValidator.validateUpdateUserRolesData,
    AdminUserCtrl.updateAdminUserRoles
  );
  app.route(
    versionConfig.routePrefix +
    "/admin/users/:userId/credits/transactions"
  ).get(  
    AuthMiddleware.isAdminUser,
    AdminUserCtrl.getUserCreditTransactions
  );

  app.route(
    versionConfig.routePrefix +
    "/admin/users/:userId/orders"
  ).get(
    AuthMiddleware.isAdminUser,
    AdminUserCtrl.getUserOrders
  );

  app.route(
    versionConfig.routePrefix +
    "/admin/users/:userId/entitlements"
  ).get(
    AuthMiddleware.isAdminUser,
    AdminUserCtrl.getUserEntitlements
  );

  app.route(
    versionConfig.routePrefix +
    "/admin/consumer-devices/by-device-id/:deviceId/hover-card"
  ).get(
    AuthMiddleware.isAdminUser,
    AdminUserCtrl.getGuestDeviceHoverCard
  );

  app.route(
    versionConfig.routePrefix +
    "/admin/consumer-devices/by-device-id/:deviceId/orders"
  ).get(
    AuthMiddleware.isAdminUser,
    AdminUserCtrl.getGuestDeviceOrders
  );

  app.route(
    versionConfig.routePrefix +
    "/admin/consumer-devices/by-device-id/:deviceId/credits/transactions"
  ).get(
    AuthMiddleware.isAdminUser,
    AdminUserCtrl.getGuestDeviceCreditTransactions
  );

  app.route(
    versionConfig.routePrefix +
    "/admin/consumer-devices/by-device-id/:deviceId/entitlements"
  ).get(
    AuthMiddleware.isAdminUser,
    AdminUserCtrl.getGuestDeviceEntitlements
  );

  app.route(
    versionConfig.routePrefix +
    "/admin/consumer-devices/by-device-id/:deviceId"
  ).get(
    AuthMiddleware.isAdminUser,
    AdminUserCtrl.getGuestDeviceSnapshot
  );

  app.route(
    versionConfig.routePrefix +
    "/admin/consumer-users/by-user-id/:userId/hover-card"
  ).get(
    AuthMiddleware.isAdminUser,
    AdminUserCtrl.getConsumerUserHoverCard
  );

  app.route(
    versionConfig.routePrefix +
    "/admin/consumer-users/by-user-id/:userId"
  ).get(
    AuthMiddleware.isAdminUser,
    AdminUserCtrl.getConsumerUserSnapshotByUserId
  );

  app.route(
    versionConfig.routePrefix +
    "/admin/consumer-users/lookup"
  ).get(
    AuthMiddleware.isAdminUser,
    AdminUserCtrl.lookupConsumerUserForSupport
  );

  app.route(
    versionConfig.routePrefix +
    "/admin/consumer-users/search-for-ticket"
  ).get(
    AuthMiddleware.isAdminUser,
    AdminUserCtrl.searchConsumersForSupportTicket
  );
};

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
};

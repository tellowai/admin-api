'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const PermissionMiddleware = require('../../auth/middlewares/permission.middleware');
const RoleCtrl = require('../controllers/role.controller');
const RoleValidator = require('../validators/role.validator');

module.exports = function (app) {
  // Get all roles - OWNER ONLY
  app.route(versionConfig.routePrefix + '/admin/roles')
    .get(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.isOwner(),
      RoleCtrl.getAllRoles
    );

  // Create role - OWNER ONLY
  app.route(versionConfig.routePrefix + '/admin/roles')
    .post(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.isOwner(),
      RoleValidator.validateCreateRoleData,
      RoleCtrl.createRole
    );

  // Get role by ID - OWNER ONLY
  app.route(versionConfig.routePrefix + '/admin/roles/:roleId')
    .get(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.isOwner(),
      RoleCtrl.getRoleById
    );

  // Update role - OWNER ONLY
  app.route(versionConfig.routePrefix + '/admin/roles/:roleId')
    .patch(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.isOwner(),
      RoleValidator.validateUpdateRoleData,
      RoleCtrl.updateRole
    );

  // Delete role - OWNER ONLY
  app.route(versionConfig.routePrefix + '/admin/roles/:roleId')
    .delete(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.isOwner(),
      RoleCtrl.deleteRole
    );

  // Get all permissions - OWNER ONLY
  app.route(versionConfig.routePrefix + '/admin/permissions')
    .get(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.isOwner(),
      RoleCtrl.getAllPermissions
    );

  // Assign permissions to role - OWNER ONLY
  app.route(versionConfig.routePrefix + '/admin/roles/:roleId/permissions')
    .post(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.isOwner(),
      RoleValidator.validateAssignPermissionsData,
      RoleCtrl.assignPermissionsToRole
    );

  // Update role permissions (replace all) - OWNER ONLY
  app.route(versionConfig.routePrefix + '/admin/roles/:roleId/permissions')
    .patch(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.isOwner(),
      RoleValidator.validateUpdateRolePermissionsData,
      RoleCtrl.updateRolePermissions
    );

  // Remove permission from role - OWNER ONLY
  app.route(versionConfig.routePrefix + '/admin/roles/:roleId/permissions/:permissionId')
    .delete(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.isOwner(),
      RoleCtrl.removePermissionFromRole
    );
};

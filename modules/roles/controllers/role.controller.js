'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const RoleModel = require('../models/role.model');
const RbacModel = require('../../auth/models/rbac.model');
const config = require('../../../config/config');
const { publishNewAdminActivityLog } = require('../../core/controllers/activitylog.controller');

/**
 * @api {get} /admin/roles Get all roles
 * @apiName GetAllRoles
 * @apiGroup Roles
 *
 * @apiParam {Number} page Page number (optional)
 * @apiParam {Number} limit Items per page (optional)
 *
 * @apiSuccess {Array} data Array of role objects
 */
exports.getAllRoles = async function(req, res) {
  try {
    const page = req.query.page ? (req.query.page > 0 ? parseInt(req.query.page) : config.pagination.page) : config.pagination.page;
    const limit = req.query.limit ? (req.query.limit > 0 ? parseInt(req.query.limit) : config.pagination.limit) : config.pagination.limit;
    const offset = (page - 1) * limit;

    const roles = await RoleModel.getAllRoles(limit, offset);

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: roles
    });
  } catch (error) {
    console.error('Error fetching roles:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('ROLES_FETCH_FAILED') || 'Failed to fetch roles'
    });
  }
};

/**
 * @api {get} /admin/roles/:roleId Get role by ID
 * @apiName GetRoleById
 * @apiGroup Roles
 *
 * @apiParam {String} roleId Role ID
 *
 * @apiSuccess {Object} data Role object with permissions
 */
exports.getRoleById = async function(req, res) {
  try {
    const { roleId } = req.params;
    
    const role = await RoleModel.getRoleById(roleId);
    
    if (!role) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('ROLE_NOT_FOUND') || 'Role not found'
      });
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: role
    });
  } catch (error) {
    console.error('Error fetching role:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('ROLE_FETCH_FAILED') || 'Failed to fetch role'
    });
  }
};

/**
 * @api {post} /admin/roles Create new role
 * @apiName CreateRole
 * @apiGroup Roles
 *
 * @apiParam {String} role_name Role name
 * @apiParam {String} role_description Role description (optional)
 *
 * @apiSuccess {Object} data Created role object
 */
exports.createRole = async function(req, res) {
  try {
    const roleData = req.validatedBody;
    
    // Prevent creating a role with name 'owner'
    if (roleData.role_name && roleData.role_name.toLowerCase() === 'owner') {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('OWNER_ROLE_NAME_RESERVED') || 'Role name "owner" is reserved and cannot be used'
      });
    }
    
    const role = await RoleModel.createRole(roleData);

    // Publish activity log
    publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'ROLE',
      actionName: 'CREATE_ROLE',
      entityId: role.role_id,
      additionalData: { role_name: role.role_name }
    });

    return res.status(HTTP_STATUS_CODES.CREATED).json({
      data: role,
      message: req.t('ROLE_CREATED_SUCCESS') || 'Role created successfully'
    });
  } catch (error) {
    console.error('Error creating role:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('ROLE_CREATION_FAILED') || 'Failed to create role'
    });
  }
};

/**
 * @api {patch} /admin/roles/:roleId Update role
 * @apiName UpdateRole
 * @apiGroup Roles
 *
 * @apiParam {String} roleId Role ID
 * @apiParam {String} role_name Role name (optional)
 * @apiParam {String} role_description Role description (optional)
 *
 * @apiSuccess {Object} data Updated role object
 */
exports.updateRole = async function(req, res) {
  try {
    const { roleId } = req.params;
    const roleData = req.validatedBody;
    
    // Check if role exists and get its name
    const existingRole = await RoleModel.getRoleById(roleId);
    if (!existingRole) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('ROLE_NOT_FOUND') || 'Role not found'
      });
    }
    
    // Prevent updating the 'owner' role
    if (existingRole.role_name === 'owner') {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('OWNER_ROLE_NOT_EDITABLE') || 'Owner role cannot be modified'
      });
    }
    
    const role = await RoleModel.updateRole(roleId, roleData);
    
    if (!role) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('ROLE_NOT_FOUND') || 'Role not found'
      });
    }

    // Publish activity log
    publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'ROLE',
      actionName: 'UPDATE_ROLE',
      entityId: roleId,
      additionalData: roleData
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: role,
      message: req.t('ROLE_UPDATED_SUCCESS') || 'Role updated successfully'
    });
  } catch (error) {
    console.error('Error updating role:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('ROLE_UPDATE_FAILED') || 'Failed to update role'
    });
  }
};

/**
 * @api {delete} /admin/roles/:roleId Delete role
 * @apiName DeleteRole
 * @apiGroup Roles
 *
 * @apiParam {String} roleId Role ID
 *
 * @apiSuccess {String} message Success message
 */
exports.deleteRole = async function(req, res) {
  try {
    const { roleId } = req.params;
    
    // Check if role exists and get its name
    const existingRole = await RoleModel.getRoleById(roleId);
    if (!existingRole) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('ROLE_NOT_FOUND') || 'Role not found'
      });
    }
    
    // Prevent deleting the 'owner' role
    if (existingRole.role_name === 'owner') {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('OWNER_ROLE_NOT_DELETABLE') || 'Owner role cannot be deleted'
      });
    }
    
    const deleted = await RoleModel.deleteRole(roleId);
    
    if (!deleted) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('ROLE_NOT_FOUND') || 'Role not found'
      });
    }

    // Publish activity log
    publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'ROLE',
      actionName: 'DELETE_ROLE',
      entityId: roleId
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('ROLE_DELETED_SUCCESS') || 'Role deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting role:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('ROLE_DELETION_FAILED') || 'Failed to delete role'
    });
  }
};

/**
 * @api {get} /admin/permissions Get all permissions
 * @apiName GetAllPermissions
 * @apiGroup Permissions
 *
 * @apiSuccess {Array} data Array of permission objects
 */
exports.getAllPermissions = async function(req, res) {
  try {
    const permissions = await RbacModel.getAllPermissions();

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: permissions
    });
  } catch (error) {
    console.error('Error fetching permissions:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('PERMISSIONS_FETCH_FAILED') || 'Failed to fetch permissions'
    });
  }
};

/**
 * @api {post} /admin/roles/:roleId/permissions Assign permissions to role
 * @apiName AssignPermissionsToRole
 * @apiGroup Roles
 *
 * @apiParam {String} roleId Role ID
 * @apiParam {Array} permission_ids Array of permission IDs
 *
 * @apiSuccess {Object} data Success message and count
 */
exports.assignPermissionsToRole = async function(req, res) {
  try {
    const { roleId } = req.params;
    const { permission_ids } = req.validatedBody;
    
    const count = await RoleModel.assignPermissionsToRole(roleId, permission_ids);

    // Publish activity log
    publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'ROLE',
      actionName: 'ASSIGN_PERMISSIONS_TO_ROLE',
      entityId: roleId,
      additionalData: { permission_ids, count }
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('PERMISSIONS_ASSIGNED_SUCCESS') || 'Permissions assigned successfully',
      data: { count }
    });
  } catch (error) {
    console.error('Error assigning permissions:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('PERMISSIONS_ASSIGNMENT_FAILED') || 'Failed to assign permissions'
    });
  }
};

/**
 * @api {delete} /admin/roles/:roleId/permissions/:permissionId Remove permission from role
 * @apiName RemovePermissionFromRole
 * @apiGroup Roles
 *
 * @apiParam {String} roleId Role ID
 * @apiParam {String} permissionId Permission ID
 *
 * @apiSuccess {String} message Success message
 */
exports.removePermissionFromRole = async function(req, res) {
  try {
    const { roleId, permissionId } = req.params;
    
    const removed = await RoleModel.removePermissionFromRole(roleId, permissionId);
    
    if (!removed) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('PERMISSION_NOT_FOUND') || 'Permission not found or already removed'
      });
    }

    // Publish activity log
    publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'ROLE',
      actionName: 'REMOVE_PERMISSION_FROM_ROLE',
      entityId: roleId,
      additionalData: { permission_id: permissionId }
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('PERMISSION_REMOVED_SUCCESS') || 'Permission removed successfully'
    });
  } catch (error) {
    console.error('Error removing permission:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('PERMISSION_REMOVAL_FAILED') || 'Failed to remove permission'
    });
  }
};

/**
 * @api {patch} /admin/roles/:roleId/permissions Update role permissions (replace all)
 * @apiName UpdateRolePermissions
 * @apiGroup Roles
 *
 * @apiParam {String} roleId Role ID
 * @apiParam {Array} permission_ids Array of permission IDs
 *
 * @apiSuccess {Object} data Success message and count
 */
exports.updateRolePermissions = async function(req, res) {
  try {
    const { roleId } = req.params;
    const { permission_ids } = req.validatedBody;
    
    const count = await RoleModel.updateRolePermissions(roleId, permission_ids);

    // Publish activity log
    publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'ROLE',
      actionName: 'UPDATE_ROLE_PERMISSIONS',
      entityId: roleId,
      additionalData: { permission_ids, count }
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('ROLE_PERMISSIONS_UPDATED_SUCCESS') || 'Role permissions updated successfully',
      data: { count }
    });
  } catch (error) {
    console.error('Error updating role permissions:', error);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({
      message: req.t('ROLE_PERMISSIONS_UPDATE_FAILED') || 'Failed to update role permissions'
    });
  }
};

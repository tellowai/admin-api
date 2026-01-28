'use strict';
const i18next = require('i18next');
const ManageAdminUserDbo = require('../models/admin.user.model');
const AdminUserErrorHandler = require('../middlewares/admin.user.error.handler');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const CUSTOM_ERROR_CODES = require('../../core/controllers/customerrorcodes.server.controller').CODES;
const AdminUserUtils = require('../utils/admin.user.utils');
const config = require('../../../config/config');
const coreUtils = require('../../core/controllers/utils.controller');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const { publishNewAdminActivityLog } = require('../../core/controllers/activitylog.controller');
const { ROLES } = require('../../auth/constants/permissions.constants');
const RbacModel = require('../../auth/models/rbac.model');



/**
 * @api {post} /admin/users Create a new admin user
 * @apiName CreateNewAdminuser
 * @apiGroup AdminUsers
 *
 * @apiParam {String} user_id (mandatory).
 * @apiParam {Array} roles (mandatory).
 * 
 * @apiSuccess {String} message New user added as admin.
 * @apiSuccess {Object} group User id and roles object.
 * 
 * @apiError {String} message Error message.
 */

exports.createNewAdminUserWithSelectRoles = async function (req, res, next) {
  try {
    const newAdminUser = req.validatedBody;
    const requesterRoles = req.user.roles || [];

    if(!newAdminUser.roles || !newAdminUser.roles.length) {
      throw {
        message: i18next.t("user:ROLES_NOT_ASSIGNED"),
        customErrCode: CUSTOM_ERROR_CODES.ROLE_NOT_ASSSIGNED,
        httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST
      };
    }

    // Prevent assigning 'owner' role - it's not assignable
    if(newAdminUser.roles.includes(ROLES.OWNER)) {
      throw {
        message: i18next.t("user:OWNER_ROLE_NOT_ASSIGNABLE"),
        customErrCode: CUSTOM_ERROR_CODES.OWNER_ROLE_NOT_ASSIGNABLE,
        httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST
      };
    }

    // Admin users can only assign 'editor' role - not 'admin'
    // Only owner can assign 'admin' role
    const isOwner = requesterRoles.includes(ROLES.OWNER);
    if (!isOwner && newAdminUser.roles.includes(ROLES.ADMIN)) {
      throw {
        message: i18next.t("user:ONLY_OWNER_CAN_ASSIGN_ADMIN_ROLE") || 'Only owner can assign admin role',
        customErrCode: CUSTOM_ERROR_CODES.PERMISSION_DENIED,
        httpStatusCode: HTTP_STATUS_CODES.FORBIDDEN
      };
    }

    // Fetch role ids for given role names
    const roleIds = await ManageAdminUserDbo.getRoleIdsWithRoleNames(newAdminUser.roles);

    // Transform user data into DB schema format
    let memberWithRolesArray = AdminUserUtils.changeAdminuserDataIntoDbSchema(newAdminUser, roleIds);

    // Create new admin user with given roles
    await ManageAdminUserDbo.createNewAdminUser(memberWithRolesArray);

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'ADMIN_USER',
          action_name: 'ADD_ADMIN_USER', 
          entity_id: newAdminUser.user_id
        }
      }],
      'create_admin_activity_log'
    );

    // Send response
    return res.status(HTTP_STATUS_CODES.OK).json({
      data: newAdminUser
    });

  } catch (err) {
    err.custom = {
      httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
      message: req.t('user:ADMIN_USER_CREATION_FAILED')
    };

    return AdminUserErrorHandler.handleNewAdminCreationErrors(err, res);
  }
};



/**
 * @api {delete} /api/admin/user/:userId Delete Admin User
 * @apiName DeleteAdminUser
 * @apiGroup AdminUsers
 *
 * @apiParam {String} userId Admin User ID.
 * 
 * @apiSuccess {String} message Success message.
 * 
 * @apiError {String} message Error message.
 */
exports.deleteAdminUser = async function (req, res, next) {
  try {
    const { userId } = req.params;
    const { userId: adminUserId } = req.user;
    const requesterRoles = req.user.roles || [];

    if(userId === adminUserId) {
      throw {
        message: i18next.t("user:YOU_CANNOT_DELETE_YOURSELF"),
        customErrCode: CUSTOM_ERROR_CODES.YOU_CANNOT_DELETE_YOURSELF,
        httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST
      }; 
    }

    // Admin can only delete users with 'editor' role
    // Admin cannot delete other admins or owners
    const isOwner = requesterRoles.includes(ROLES.OWNER);
    if (!isOwner) {
      // Check target user's roles
      const targetUserRoles = await RbacModel.getUserRoles(userId);
      const targetRoleNames = targetUserRoles.map(r => r.role_name);
      
      // If target has admin or owner role, deny deletion
      if (targetRoleNames.includes(ROLES.ADMIN) || targetRoleNames.includes(ROLES.OWNER)) {
        throw {
          message: i18next.t("user:ADMIN_CANNOT_DELETE_ADMIN_OR_OWNER") || 'Admin cannot delete other admins or owners',
          customErrCode: CUSTOM_ERROR_CODES.PERMISSION_DENIED,
          httpStatusCode: HTTP_STATUS_CODES.FORBIDDEN
        };
      }
    }

    await ManageAdminUserDbo.deleteAdminUser(userId);

    // publish an event to kafka - activitylog
    const activityLogObj =  { 
      adminUserId: req.user.userId,
      entityType: 'ADMIN_USER',
      actionName: 'DELETE_ADMIN_USER', 
      entityId: userId,
      additionalData: {}
    }
    publishNewAdminActivityLog(activityLogObj);

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('user:ADMIN_USER_DELETED_SUCCESSFULLY')
    });

  } catch (err) {
    err.custom = {
      httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
      message: req.t('user:ADMIN_USER_DELETION_FAILED')
    };

    return AdminUserErrorHandler.handleNewAdminDeletionErrors(err, res);
  }
};

exports.getAdminUsersList = async function (req, res) {
  try {
    const page = req.query.page ? (req.query.page>0 ? parseInt(req.query.page) : config.pagination.page) : config.pagination.page;
    const limit = req.query.limit ? (req.query.limit>0 ? parseInt(req.query.limit) : config.pagination.limit) : config.pagination.limit;
    const offset = (page - 1) * limit;

    // Get all users with pagination
    const adminUserIdsWithFullObj = await ManageAdminUserDbo.getAdminUserIds(limit, offset);
    const adminUserIdsArr = (adminUserIdsWithFullObj.length)? adminUserIdsWithFullObj.map(user => user.user_id) : [];

    let adminUsers = [];
    
    if(adminUserIdsArr.length) {
      adminUsers = await ManageAdminUserDbo.getUsersFromIds(adminUserIdsArr);

      // sort they array by admin user created at
      adminUsers = coreUtils.sortArr1DataByArr2(adminUsers, adminUserIdsWithFullObj, 'user_id');
      
      // Get roles for all admin users
      const rolesData = await ManageAdminUserDbo.getRolesForUsers(adminUserIdsArr);
      const rolesMap = {};
      rolesData.forEach(item => {
        rolesMap[item.user_id] = item.roles;
      });
      
      // Add roles to each user (empty array if no roles)
      adminUsers = adminUsers.map(user => ({
        ...user,
        roles: rolesMap[user.user_id] || []
      }));
    }


    return res.status(HTTP_STATUS_CODES.OK).json({
      data: adminUsers
    });
  } catch (err) {
    err.custom = {
      httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
      message: err.message || req.t('user:ADMIN_USERS_LIST_RETRIEVAL_FAILED')
    };

    return AdminUserErrorHandler.handleNewAdminCreationErrors(err, res);
  }
};

exports.bulkRemoveAdminUsers = async function (req, res, next) {
  try {
    const { user_ids: userIds } = req.validatedBody;
    const { userId: adminUserId } = req.user;
    const requesterRoles = req.user.roles || [];
    let finalUserIds = userIds;

    // Filter out self
    if(userIds.length && userIds.includes(adminUserId)) {
      finalUserIds = userIds.filter(item => item !== adminUserId);
    }

    // Admin can only delete users with 'editor' role
    // Admin cannot delete other admins or owners
    const isOwner = requesterRoles.includes(ROLES.OWNER);
    if (!isOwner && finalUserIds.length) {
      // Get roles for all target users
      const rolesData = await ManageAdminUserDbo.getRolesForUsers(finalUserIds);
      
      // Filter out users with admin or owner role
      const protectedUserIds = [];
      rolesData.forEach(item => {
        const roleNames = (item.roles || []).map(r => r.role_name);
        if (roleNames.includes(ROLES.ADMIN) || roleNames.includes(ROLES.OWNER)) {
          protectedUserIds.push(item.user_id);
        }
      });
      
      // Remove protected users from deletion list
      if (protectedUserIds.length) {
        finalUserIds = finalUserIds.filter(id => !protectedUserIds.includes(id));
      }
    }

    if(finalUserIds.length){
      await ManageAdminUserDbo.bulkDeleteAdminUsers(finalUserIds);

      // publish an event to kafka - activitylog
      const activityLogObj =  { 
        adminUserId: req.user.userId,
        entityType: 'ADMIN_USER',
        actionName: 'BULK_DELETE_ADMIN_USERS', 
        entityId: 'BULK',
        additionalData: {
          userIds: finalUserIds
        }
      }
      publishNewAdminActivityLog(activityLogObj);
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('user:ADMIN_USER_DELETED_SUCCESSFULLY')
    });

  } catch (err) {
    err.custom = {
      httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
      message: req.t('user:ADMIN_USER_DELETION_FAILED')
    };

    return AdminUserErrorHandler.handleNewAdminDeletionErrors(err, res);
  }
};

exports.searchAdminUsersByEmail = async function (req, res) {
  try {
    const page = req.query.page ? (req.query.page>0 ? parseInt(req.query.page) : config.pagination.page) : config.pagination.page;
    const limit = req.query.limit ? (req.query.limit>0 ? parseInt(req.query.limit) : config.pagination.limit) : config.pagination.limit;
    const offset = (page - 1) * limit;
    const q = req.query.q;
    const searchType = req.query.searchType || 'both'; // 'email', 'mobile', or 'both'
    let usersWithFullObj = [];

    if(q) {
      usersWithFullObj = await ManageAdminUserDbo.searchAdminUsersByEmailOrMobile(q, limit, offset, searchType);
    }

    const userIdsArr = (usersWithFullObj.length)? usersWithFullObj.map(user => user.user_id) : [];

    let adminUsers = [];
    
    if(userIdsArr.length) {
      adminUsers = await ManageAdminUserDbo.getAdminUsersFromIds(userIdsArr);

      usersWithFullObj = usersWithFullObj.map(user => {
          // Check if user_id from ar1 exists in ar2
          const isAdmin = adminUsers.some(item => item.user_id === user.user_id);
      
          // Return a new object with all properties of the user and isAdmin
          return { ...user, isAdmin };
      });
    }


    return res.status(HTTP_STATUS_CODES.OK).json({
      data: usersWithFullObj
    });
  } catch (err) {
    err.custom = {
      httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
      message: err.message || req.t('user:ADMIN_USERS_LIST_RETRIEVAL_FAILED')
    };

    return AdminUserErrorHandler.handleNewAdminCreationErrors(err, res);
  }
};

/**
 * @api {put} /admin/users/:userId/roles Update admin user roles
 * @apiName UpdateAdminUserRoles
 * @apiGroup AdminUsers
 *
 * @apiParam {String} userId User ID
 * @apiParam {Array} roles Array of role names (e.g., ['admin', 'editor'])
 * 
 * @apiSuccess {String} message Success message
 * @apiSuccess {Object} data Updated user data with roles
 * 
 * @apiError {String} message Error message
 */
exports.updateAdminUserRoles = async function (req, res, next) {
  try {
    const { userId } = req.params;
    const { roles } = req.validatedBody;
    const requesterRoles = req.user.roles || [];

    if(!roles || !roles.length) {
      throw {
        message: i18next.t("user:ROLES_NOT_ASSIGNED"),
        customErrCode: CUSTOM_ERROR_CODES.ROLE_NOT_ASSSIGNED,
        httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST
      };
    }

    // Prevent assigning 'owner' role - it's not assignable
    if(roles.includes(ROLES.OWNER)) {
      throw {
        message: i18next.t("user:OWNER_ROLE_NOT_ASSIGNABLE"),
        customErrCode: CUSTOM_ERROR_CODES.OWNER_ROLE_NOT_ASSIGNABLE,
        httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST
      };
    }

    // Admin users can only assign 'editor' role - not 'admin'
    // Only owner can assign 'admin' role
    const isOwner = requesterRoles.includes(ROLES.OWNER);
    if (!isOwner && roles.includes(ROLES.ADMIN)) {
      throw {
        message: i18next.t("user:ONLY_OWNER_CAN_ASSIGN_ADMIN_ROLE") || 'Only owner can assign admin role',
        customErrCode: CUSTOM_ERROR_CODES.PERMISSION_DENIED,
        httpStatusCode: HTTP_STATUS_CODES.FORBIDDEN
      };
    }

    // Fetch role ids for given role names
    const roleIds = await ManageAdminUserDbo.getRoleIdsWithRoleNames(roles);
    
    if (!roleIds || roleIds.length === 0) {
      throw {
        message: i18next.t("user:INVALID_ROLES") || 'Invalid roles provided',
        customErrCode: CUSTOM_ERROR_CODES.BAD_REQUEST,
        httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST
      };
    }

    const roleIdArray = roleIds.map(r => r.role_id);

    // Update user roles
    await ManageAdminUserDbo.updateUserRoles(userId, roleIdArray);

    // Clear cache for this user
    RbacModel.clearUserCache(userId);

    // Get updated user data with roles
    const updatedRoles = await RbacModel.getUserRoles(userId);

    // Publish activity log
    publishNewAdminActivityLog({
      adminUserId: req.user.userId,
      entityType: 'ADMIN_USER',
      actionName: 'UPDATE_ADMIN_USER_ROLES',
      entityId: userId,
      additionalData: { roles: roles }
    });

    // Send response
    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('user:ADMIN_USER_ROLES_UPDATED_SUCCESSFULLY') || 'User roles updated successfully',
      data: {
        user_id: userId,
        roles: updatedRoles
      }
    });

  } catch (err) {
    err.custom = {
      httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
      message: req.t('user:ADMIN_USER_ROLES_UPDATE_FAILED') || 'Failed to update user roles'
    };

    return AdminUserErrorHandler.handleNewAdminCreationErrors(err, res);
  }
};

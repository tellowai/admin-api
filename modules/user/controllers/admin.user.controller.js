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

    if(!newAdminUser.roles || !newAdminUser.roles.length) {
      throw {
        message: i18next.t("user:ROLES_NOT_ASSIGNED"),
        customErrCode: CUSTOM_ERROR_CODES.ROLE_NOT_ASSSIGNED,
        httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST
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
    const { userId: adminUserId } = req.adminUser;

    if(userId === adminUserId) {
      throw {
        message: i18next.t("user:YOU_CANNOT_DELETE_YOURSELF"),
        customErrCode: CUSTOM_ERROR_CODES.YOU_CANNOT_DELETE_YOURSELF,
        httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST
      }; 
    }

    await ManageAdminUserDbo.deleteAdminUser(userId);

    // publish an event to kafka - activitylog
    const activityLogObj =  { 
      adminUserId: req.adminUser.userId,
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
    const { userId: adminUserId } = req.adminUser;
    let finalUserIds = userIds;

    if(userIds.length && userIds.includes(adminUserId)) {
      finalUserIds = userIds.filter(item => item !== adminUserId);
    }

    if(finalUserIds.length){
      await ManageAdminUserDbo.bulkDeleteAdminUsers(finalUserIds);

      // publish an event to kafka - activitylog
      const activityLogObj =  { 
        adminUserId: req.adminUser.userId,
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
    let usersWithFullObj = [];

    if(q) {
      usersWithFullObj = await ManageAdminUserDbo.searchAdminUsersByEmailOrMobile(q, limit, offset);
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

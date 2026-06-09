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
const CreditsModel = require('../../credits/models/credits.model');
const OrdersModel = require('../../orders/models/orders.model');
const { formatGuestDeviceDisplayName } = require('../../orders/utils/guestDeviceDisplay.util');
const PaymentPlansModel = require('../../payment-plans/models/payment-plans.model');
const orderTemplateStitch = require('../../orders/utils/orderTemplateStitch.util');
const orderLifecycleAnalyticsEnrichment = require('../../orders/utils/ordersLifecycleAnalyticsEnrichment.util');
const { purchaseCategoryFromOrder } = require('../../orders/utils/purchaseCategory.util');
const EntitlementsModel = require('../../entitlements/models/entitlements.model');
const StorageFactory = require('../../os2/providers/storage.factory');

async function resolveEndUserProfilePicUrl(userRow) {
  if (!userRow) return null;
  const storage = StorageFactory.getProvider();
  let profilePicUrl = userRow.profile_pic || null;
  const profilePicAssetKey = userRow.profile_pic_asset_key;
  const profilePicBucket = userRow.profile_pic_bucket;

  if (profilePicAssetKey) {
    try {
      if (profilePicBucket && profilePicBucket.includes('ephemeral')) {
        profilePicUrl = await storage.generateEphemeralPresignedDownloadUrl(profilePicAssetKey, {
          expiresIn: 3600
        });
      } else {
        profilePicUrl = await storage.generatePresignedDownloadUrl(profilePicAssetKey, {
          expiresIn: 3600
        });
      }
    } catch (e) {
      console.error('consumer user profile presign failed:', e.message);
    }
  } else if (profilePicUrl && !String(profilePicUrl).startsWith('http')) {
    try {
      profilePicUrl = await storage.generatePresignedDownloadUrl(profilePicUrl, { expiresIn: 3600 });
    } catch (e) {
      console.error('consumer user profile presign fallback failed:', e.message);
    }
  }

  return profilePicUrl;
}

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

exports.getUserCreditTransactions = async function (req, res) {
  try {
    const userId = req.params.userId;
    const page = req.query.page ? (req.query.page > 0 ? parseInt(req.query.page) : config.pagination.page) : config.pagination.page;
    const limit = req.query.limit ? (req.query.limit > 0 ? parseInt(req.query.limit) : config.pagination.limit) : config.pagination.limit;

    const creditData = await CreditsModel.getUserCreditsTransactions(userId, page, limit, {
      useMaster: true
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: creditData
    });
  } catch (err) {
    console.error('getUserCreditTransactions error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR || 500).json({
      message: req.t('user:USER_CREDIT_TRANSACTIONS_FAILED') || 'Failed to retrieve user credit transactions'
    });
  }
};

exports.getUserOrders = async function (req, res) {
  try {
    const userId = req.params.userId;
    const page = req.query.page ? (req.query.page > 0 ? parseInt(req.query.page) : config.pagination.page) : config.pagination.page;
    const limit = req.query.limit ? (req.query.limit > 0 ? parseInt(req.query.limit) : config.pagination.limit) : config.pagination.limit;
    const offset = (page - 1) * limit;

    const orders = await OrdersModel.getByUserId(userId, limit, offset);
    const planIds = [...new Set(orders.map(o => o.payment_plan_id).filter(Boolean))];
    const plans = planIds.length ? await PaymentPlansModel.getPlansByIds(planIds) : [];
    const planMap = {};
    for (const p of plans) planMap[p.pp_id] = p;

    const [templateNameById, packNameById] = await Promise.all([
      orderTemplateStitch.buildTemplateNameByIdMap(orders),
      orderTemplateStitch.buildPackNameByIdMap(orders)
    ]);

    const data = orders.map(order => {
      const plan = order.payment_plan_id ? planMap[order.payment_plan_id] : null;
      const planType = plan ? plan.plan_type : null;
      const billingInterval = plan ? plan.billing_interval : null;
      const tid = orderTemplateStitch.parseTemplateIdFromTransactionNotes(order.transaction_notes);
      const pid = orderTemplateStitch.parsePackIdFromTransactionNotes(order.transaction_notes);
      const { transaction_notes: _tn, ...rest } = order;
      return {
        ...rest,
        plan_type: planType ?? null,
        plan_name: plan ? (plan.plan_name || plan.plan_heading || null) : null,
        plan_heading: plan ? (plan.plan_heading || plan.plan_name || null) : null,
        billing_interval: billingInterval ?? null,
        purchase_category: purchaseCategoryFromOrder(order, plan ? { plan_type: plan.plan_type, billing_interval: plan.billing_interval } : null),
        template_id: tid,
        template_name: tid ? (templateNameById[tid] ?? null) : null,
        pack_id: pid,
        pack_name: pid ? (packNameById[pid] ?? null) : null,
        analytics_app_version: null,
        analytics_os_name: null,
        analytics_os_version: null
      };
    });

    const ctxMap = await orderLifecycleAnalyticsEnrichment.fetchLifecycleContextMapForOrderRows(orders);
    const enriched = data.map((row) =>
      orderLifecycleAnalyticsEnrichment.applyLifecycleContextToOrderPayload(row, ctxMap)
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: { orders: enriched }
    });
  } catch (err) {
    console.error('getUserOrders error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR || 500).json({
      message: req.t('user:USER_ORDERS_FAILED') || 'Failed to retrieve user orders'
    });
  }
};

/**
 * Entitlements for an end-user (not admin user): total remaining template slots + paginated rows with linked orders.
 */
exports.getUserEntitlements = async function (req, res) {
  try {
    const userId = req.params.userId;
    const page = req.query.page ? (req.query.page > 0 ? parseInt(req.query.page) : config.pagination.page) : config.pagination.page;
    const limit = req.query.limit ? (req.query.limit > 0 ? parseInt(req.query.limit) : config.pagination.limit) : config.pagination.limit;
    const offset = (page - 1) * limit;

    const [templateSlotsRemainingTotal, entitlementRows] = await Promise.all([
      EntitlementsModel.sumTemplateSlotsRemainingByUserId(userId),
      EntitlementsModel.listByUserId(userId, limit, offset)
    ]);

    const orderIds = [...new Set(entitlementRows.map((row) => row.order_id).filter((id) => id != null))];
    const orders = orderIds.length ? await OrdersModel.getByOrderIds(orderIds) : [];
    const orderMap = {};
    for (const o of orders) {
      orderMap[o.order_id] = o;
    }

    const planIds = [...new Set(orders.map((o) => o.payment_plan_id).filter(Boolean))];
    const plans = planIds.length ? await PaymentPlansModel.getPlansByIds(planIds) : [];
    const planMap = {};
    for (const p of plans) planMap[p.pp_id] = p;

    const entitlements = entitlementRows.map((row) => {
      const order = row.order_id != null ? orderMap[row.order_id] : null;
      const plan = order && order.payment_plan_id ? planMap[order.payment_plan_id] : null;
      return {
        entitlement_id: row.entitlement_id,
        user_id: row.user_id,
        order_id: row.order_id,
        template_id: row.template_id,
        tier_plan_type: row.tier_plan_type,
        template_slots_remaining: row.template_slots_remaining,
        max_creations_per_template: row.max_creations_per_template,
        status: row.status,
        is_expired: row.is_expired,
        valid_from: row.valid_from,
        valid_until: row.valid_until,
        created_at: row.created_at,
        updated_at: row.updated_at,
        order: order
          ? {
              order_id: order.order_id,
              status: order.status,
              amount_paid: order.amount_paid,
              currency: order.currency,
              payment_gateway: order.payment_gateway,
              pg_order_id: order.pg_order_id,
              created_at: order.created_at,
              plan_name: plan ? (plan.plan_name || plan.plan_heading || null) : null
            }
          : null
      };
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        template_slots_remaining_total: templateSlotsRemainingTotal,
        entitlements
      }
    });
  } catch (err) {
    console.error('getUserEntitlements error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR || 500).json({
      message: req.t('user:USER_ENTITLEMENTS_FAILED') || 'Failed to retrieve user entitlements'
    });
  }
};

async function enrichAdminProfileOrders(orders) {
  const planIds = [...new Set(orders.map((o) => o.payment_plan_id).filter(Boolean))];
  const plans = planIds.length ? await PaymentPlansModel.getPlansByIds(planIds) : [];
  const planMap = {};
  for (const p of plans) planMap[p.pp_id] = p;

  const [templateNameById, packNameById] = await Promise.all([
    orderTemplateStitch.buildTemplateNameByIdMap(orders),
    orderTemplateStitch.buildPackNameByIdMap(orders)
  ]);

  const data = orders.map((order) => {
    const plan = order.payment_plan_id ? planMap[order.payment_plan_id] : null;
    const planType = plan ? plan.plan_type : null;
    const billingInterval = plan ? plan.billing_interval : null;
    const tid = orderTemplateStitch.parseTemplateIdFromTransactionNotes(order.transaction_notes);
    const pid = orderTemplateStitch.parsePackIdFromTransactionNotes(order.transaction_notes);
    const { transaction_notes: _tn, ...rest } = order;
    return {
      ...rest,
      plan_type: planType ?? null,
      plan_name: plan ? (plan.plan_name || plan.plan_heading || null) : null,
      plan_heading: plan ? (plan.plan_heading || plan.plan_name || null) : null,
      billing_interval: billingInterval ?? null,
      purchase_category: purchaseCategoryFromOrder(
        order,
        plan ? { plan_type: plan.plan_type, billing_interval: plan.billing_interval } : null
      ),
      template_id: tid,
      template_name: tid ? (templateNameById[tid] ?? null) : null,
      pack_id: pid,
      pack_name: pid ? (packNameById[pid] ?? null) : null,
      analytics_app_version: null,
      analytics_os_name: null,
      analytics_os_version: null
    };
  });

  const ctxMap = await orderLifecycleAnalyticsEnrichment.fetchLifecycleContextMapForOrderRows(orders);
  return data.map((row) => orderLifecycleAnalyticsEnrichment.applyLifecycleContextToOrderPayload(row, ctxMap));
}

/**
 * Guest device purchase history for admin profile workspace.
 * GET /admin/consumer-devices/by-device-id/:deviceId/orders
 */
exports.getGuestDeviceOrders = async function (req, res) {
  try {
    const deviceId = String(req.params.deviceId || '').trim();
    if (!deviceId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'deviceId is required' });
    }

    const page = req.query.page ? (req.query.page > 0 ? parseInt(req.query.page) : config.pagination.page) : config.pagination.page;
    const limit = req.query.limit ? (req.query.limit > 0 ? parseInt(req.query.limit) : config.pagination.limit) : config.pagination.limit;
    const offset = (page - 1) * limit;

    const orders = await OrdersModel.getByDeviceId(deviceId, limit, offset);
    const enriched = await enrichAdminProfileOrders(orders);

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: { orders: enriched }
    });
  } catch (err) {
    console.error('getGuestDeviceOrders error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR || 500).json({
      message: 'Failed to retrieve guest device orders'
    });
  }
};

/**
 * Guest device credit ledger for admin profile workspace.
 * GET /admin/consumer-devices/by-device-id/:deviceId/credits/transactions
 */
exports.getGuestDeviceCreditTransactions = async function (req, res) {
  try {
    const deviceId = String(req.params.deviceId || '').trim();
    if (!deviceId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'deviceId is required' });
    }

    const page = req.query.page ? (req.query.page > 0 ? parseInt(req.query.page) : config.pagination.page) : config.pagination.page;
    const limit = req.query.limit ? (req.query.limit > 0 ? parseInt(req.query.limit) : config.pagination.limit) : config.pagination.limit;

    const creditData = await CreditsModel.getDeviceCreditsTransactions(deviceId, page, limit, {
      useMaster: true
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: creditData
    });
  } catch (err) {
    console.error('getGuestDeviceCreditTransactions error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR || 500).json({
      message: 'Failed to retrieve guest device credit transactions'
    });
  }
};

/**
 * Guest device template entitlements (pre-sign-in à la carte / pack purchases).
 * GET /admin/consumer-devices/by-device-id/:deviceId/entitlements
 */
exports.getGuestDeviceEntitlements = async function (req, res) {
  try {
    const deviceId = String(req.params.deviceId || '').trim();
    if (!deviceId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'deviceId is required' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const [rows, slotsTotal] = await Promise.all([
      EntitlementsModel.listByDeviceId(deviceId, limit, offset),
      EntitlementsModel.sumTemplateSlotsRemainingByDeviceId(deviceId)
    ]);

    const entitlements = (rows || []).map((row) => {
      const isExpired = row.is_expired || (row.valid_until && new Date(row.valid_until) < new Date());
      let displayStatus = row.status || 'active';
      if (isExpired) displayStatus = 'expired';
      else if (row.template_slots_remaining <= 0) displayStatus = 'exhausted';

      return {
        entitlement_id: row.entitlement_id,
        order_id: row.order_id,
        template_id: row.template_id,
        tier_plan_type: row.tier_plan_type,
        template_slots_remaining: row.template_slots_remaining,
        max_creations_per_template: row.max_creations_per_template,
        status: displayStatus,
        valid_from: row.valid_from,
        valid_until: row.valid_until,
        created_at: row.created_at
      };
    });

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        template_slots_remaining_total: slotsTotal,
        entitlements
      }
    });
  } catch (err) {
    console.error('getGuestDeviceEntitlements error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR || 500).json({
      message: 'Failed to retrieve guest device entitlements'
    });
  }
};

/**
 * Lightweight guest device preview for admin hover panels.
 * GET /admin/consumer-devices/by-device-id/:deviceId/hover-card
 */
exports.getGuestDeviceHoverCard = async function (req, res) {
  try {
    const deviceId = String(req.params.deviceId || '').trim();
    if (!deviceId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'deviceId is required' });
    }

    const [balanceMap, completedMap, boundsMap, subscription] = await Promise.all([
      CreditsModel.getBalancesByDeviceIds([deviceId]),
      ManageAdminUserDbo.countCompletedOrdersByDeviceIds([deviceId]),
      ManageAdminUserDbo.getGuestDeviceOrderBoundsByDeviceIds([deviceId]),
      ManageAdminUserDbo.getGuestDeviceSubscriptionByDeviceId(deviceId)
    ]);

    const wallet = balanceMap.get(deviceId) || { balance: 0, reserved_balance: 0 };
    const bounds = boundsMap.get(deviceId) || {};

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        device_id: deviceId,
        display_name: formatGuestDeviceDisplayName(deviceId),
        purchaser_type: 'guest_device',
        credit_balance: wallet.balance,
        credit_reserved_balance: wallet.reserved_balance,
        completed_orders_count: completedMap.get(deviceId) || 0,
        order_count: bounds.order_count || 0,
        first_order_at: bounds.first_order_at || null,
        last_order_at: bounds.last_order_at || null,
        subscription_status: subscription?.status || null,
        subscription_claimed_at: subscription?.claimed_at || null
      }
    });
  } catch (err) {
    console.error('getGuestDeviceHoverCard error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR || 500).json({
      message: 'Failed to load guest device preview'
    });
  }
};

/**
 * Guest device profile snapshot for admin slideout panels.
 * GET /admin/consumer-devices/by-device-id/:deviceId
 */
exports.getGuestDeviceSnapshot = async function (req, res) {
  try {
    const deviceId = String(req.params.deviceId || '').trim();
    if (!deviceId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'deviceId is required' });
    }

    const [balanceMap, completedMap, boundsMap, subscription] = await Promise.all([
      CreditsModel.getBalancesByDeviceIds([deviceId]),
      ManageAdminUserDbo.countCompletedOrdersByDeviceIds([deviceId]),
      ManageAdminUserDbo.getGuestDeviceOrderBoundsByDeviceIds([deviceId]),
      ManageAdminUserDbo.getGuestDeviceSubscriptionByDeviceId(deviceId)
    ]);

    const wallet = balanceMap.get(deviceId) || { balance: 0, reserved_balance: 0 };
    const bounds = boundsMap.get(deviceId) || {};

    const displayName = formatGuestDeviceDisplayName(deviceId);
    const guestUser = {
      user_id: null,
      device_id: deviceId,
      display_name: displayName,
      purchaser_type: 'guest_device',
      email: null,
      mobile: null,
      mobile_number: null,
      profile_pic: null
    };

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        device_id: deviceId,
        display_name: displayName,
        purchaser_type: 'guest_device',
        user: guestUser,
        credit_balance: wallet.balance,
        credit_reserved_balance: wallet.reserved_balance,
        completed_orders_count: completedMap.get(deviceId) || 0,
        order_count: bounds.order_count || 0,
        first_order_at: bounds.first_order_at || null,
        last_order_at: bounds.last_order_at || null,
        subscription: subscription
          ? {
              subscription_id: subscription.subscription_id,
              status: subscription.status,
              provider_plan_id: subscription.provider_plan_id,
              start_at: subscription.start_at,
              claimed_at: subscription.claimed_at
            }
          : null
      }
    });
  } catch (err) {
    console.error('getGuestDeviceSnapshot error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR || 500).json({
      message: 'Failed to load guest device profile'
    });
  }
};

/**
 * Lightweight end-user preview for admin hover panels.
 * GET /admin/consumer-users/by-user-id/:userId/hover-card
 */
exports.getConsumerUserHoverCard = async function (req, res) {
  try {
    const userId = String(req.params.userId || '').trim();
    if (!userId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'userId is required' });
    }

    const userRow = await ManageAdminUserDbo.getEndUserHoverCardByUserId(userId);
    if (!userRow) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'User not found' });
    }

    const [profilePicUrl, balanceMap, completedOrders] = await Promise.all([
      resolveEndUserProfilePicUrl(userRow),
      CreditsModel.getBalancesByUserIds([userId]),
      ManageAdminUserDbo.countCompletedOrdersByUserId(userId)
    ]);
    const wallet = balanceMap.get(userId) || { balance: 0, reserved_balance: 0 };

    const displayName = userRow.display_name && String(userRow.display_name).trim()
      ? String(userRow.display_name).trim()
      : `${userRow.first_name || ''} ${userRow.last_name || ''}`.trim() || null;

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        user_id: userRow.user_id,
        display_name: displayName,
        email: userRow.email || null,
        mobile: userRow.mobile || null,
        profile_pic_url: profilePicUrl,
        credit_balance: wallet.balance,
        credit_reserved_balance: wallet.reserved_balance,
        completed_orders_count: completedOrders,
        member_since: userRow.created_at || null
      }
    });
  } catch (err) {
    console.error('getConsumerUserHoverCard error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR || 500).json({
      message: 'Failed to load user preview'
    });
  }
};

/**
 * End-user profile snapshot by primary user id (same row shape as consumer lookup `user`).
 * GET /admin/consumer-users/by-user-id/:userId
 */
exports.getConsumerUserSnapshotByUserId = async function (req, res) {
  try {
    const userId = String(req.params.userId || '').trim();
    if (!userId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'userId is required' });
    }

    const userRow = await ManageAdminUserDbo.getEndUserSnapshotByUserId(userId);
    if (!userRow) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'User not found' });
    }

    const payloadUser = {
      ...userRow,
      mobile_number: userRow.mobile
    };

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        user_id: userRow.user_id,
        user: payloadUser
      }
    });
  } catch (err) {
    console.error('getConsumerUserSnapshotByUserId error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR || 500).json({
      message: 'Failed to load user profile'
    });
  }
};

/**
 * Lookup an end-user by mobile (substring) or internal order_id for support tooling.
 * GET /admin/consumer-users/lookup?q=&type=mobile|order_id|user_id
 */
exports.lookupConsumerUserForSupport = async function (req, res) {
  try {
    const type = String(req.query.type || 'mobile').toLowerCase();
    const rawQ = String(req.query.q || '').trim();
    if (!rawQ) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'Query (q) is required' });
    }

    let userRow = null;

    if (type === 'user_id') {
      const userId = rawQ;
      if (userId.length < 3) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: 'Enter at least 3 characters of the user ID'
        });
      }
      userRow = await ManageAdminUserDbo.getEndUserSnapshotByUserId(userId);
      if (!userRow) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'User not found' });
      }
    } else if (type === 'order_id') {
      const digits = rawQ.replace(/\D/g, '') || rawQ;
      const orderId = parseInt(digits, 10);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'Invalid order ID' });
      }
      const userId = await ManageAdminUserDbo.findUserIdByOrderId(orderId);
      if (!userId) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'No order found for this ID' });
      }
      userRow = await ManageAdminUserDbo.getEndUserSnapshotByUserId(userId);
    } else if (type === 'mobile') {
      const mobileDigits = rawQ.replace(/\D/g, '');
      if (!mobileDigits) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: 'Enter a mobile number with at least one digit'
        });
      }
      const rows = await ManageAdminUserDbo.lookupEndUsersByMobile(rawQ, 3);
      if (rows.length === 0) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'No user found' });
      }
      if (rows.length > 1) {
        return res.status(HTTP_STATUS_CODES.CONFLICT).json({
          message: 'Multiple users match this mobile number; narrow your search',
          data: { match_count: rows.length }
        });
      }
      userRow = rows[0];
    } else {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'type must be mobile, order_id, or user_id'
      });
    }

    if (!userRow) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'User not found' });
    }

    const payloadUser = {
      ...userRow,
      mobile_number: userRow.mobile
    };

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        user_id: userRow.user_id,
        user: payloadUser
      }
    });
  } catch (err) {
    console.error('lookupConsumerUserForSupport error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR || 500).json({
      message: 'Lookup failed'
    });
  }
};

/**
 * Search end-users for "create support ticket" — returns up to N matches (table pick in UI).
 * GET /admin/consumer-users/search-for-ticket?q=&type=mobile|name&limit=
 */
exports.searchConsumersForSupportTicket = async function (req, res) {
  try {
    const type = String(req.query.type || 'mobile').toLowerCase();
    const rawQ = String(req.query.q || '').trim();
    const allowed = new Set(['mobile', 'name']);
    if (!allowed.has(type)) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'type must be mobile or name'
      });
    }

    if (!rawQ) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'Query (q) is required' });
    }

    if (type === 'mobile') {
      const mobileDigits = rawQ.replace(/\D/g, '');
      if (!mobileDigits) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: 'Enter a mobile number with at least one digit'
        });
      }
    } else if (rawQ.length < 2) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Enter at least 2 characters'
      });
    }

    const limitRaw = parseInt(String(req.query.limit || '25'), 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 25;

    const rows = await ManageAdminUserDbo.searchEndUsersForSupportTicket(type, rawQ, limit);
    const matches = (rows || []).map((row) => ({
      ...row,
      mobile_number: row.mobile
    }));

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: {
        matches,
        count: matches.length
      }
    });
  } catch (err) {
    console.error('searchConsumersForSupportTicket error:', err);
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR || 500).json({
      message: 'Search failed'
    });
  }
};

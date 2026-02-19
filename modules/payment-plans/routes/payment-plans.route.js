'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const PermissionMiddleware = require('../../auth/middlewares/permission.middleware');
const { PERMISSIONS } = require('../../auth/constants/permissions.constants');
const PaymentPlansCtrl = require('../controllers/payment-plans.controller');
const PaymentPlansValidator = require('../validators/payment-plans.validator');

module.exports = function (app) {
  // List payment plans - requires view_pricing or manage_pricing
  app.route(versionConfig.routePrefix + '/payment-plans')
    .get(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.hasAnyPermission([PERMISSIONS.MANAGE_PRICING, PERMISSIONS.VIEW_PRICING]),
      PaymentPlansCtrl.listPlans
    );

  // Create payment plan - requires manage_pricing
  app.route(versionConfig.routePrefix + '/payment-plans')
    .post(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.hasPermission(PERMISSIONS.MANAGE_PRICING),
      PaymentPlansValidator.validateCreatePlanData,
      PaymentPlansCtrl.createPlan
    );

  // Get payment plan details - requires view_pricing or manage_pricing
  app.route(versionConfig.routePrefix + '/payment-plans/:planId')
    .get(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.hasAnyPermission([PERMISSIONS.MANAGE_PRICING, PERMISSIONS.VIEW_PRICING]),
      PaymentPlansCtrl.getPlan
    );

  // Update payment plan - requires manage_pricing
  app.route(versionConfig.routePrefix + '/payment-plans/:planId')
    .patch(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.hasPermission(PERMISSIONS.MANAGE_PRICING),
      PaymentPlansValidator.validateUpdatePlanData,
      PaymentPlansCtrl.updatePlan
    );

  // Toggle plan status (active/inactive) - requires manage_pricing
  app.route(versionConfig.routePrefix + '/payment-plans/:planId/status')
    .patch(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.hasPermission(PERMISSIONS.MANAGE_PRICING),
      PaymentPlansValidator.validateToggleStatusData,
      PaymentPlansCtrl.togglePlanStatus
    );

  // Copy plan - requires manage_pricing
  app.route(versionConfig.routePrefix + '/payment-plans/:planId/copy')
    .post(
      AuthMiddleware.isAdminUser,
      PermissionMiddleware.hasPermission(PERMISSIONS.MANAGE_PRICING),
      PaymentPlansValidator.validatePlanIdParam,
      PaymentPlansCtrl.copyPlan
    );
};

'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const PaymentPlansCtrl = require('../controllers/payment-plans.controller');
const PaymentPlansValidator = require('../validators/payment-plans.validator');

module.exports = function (app) {
  // List payment plans
  app.route(versionConfig.routePrefix + '/payment-plans')
    .get(AuthMiddleware.isAuthorizedJWT, PaymentPlansCtrl.listPlans);

  // Create payment plan
  app.route(versionConfig.routePrefix + '/payment-plans')
    .post(
      AuthMiddleware.isAuthorizedJWT,
      PaymentPlansValidator.validateCreatePlanData,
      PaymentPlansCtrl.createPlan
    );

  // Get payment plan details
  app.route(versionConfig.routePrefix + '/payment-plans/:planId')
    .get(AuthMiddleware.isAuthorizedJWT, PaymentPlansCtrl.getPlan);

  // Update payment plan
  app.route(versionConfig.routePrefix + '/payment-plans/:planId')
    .patch(
      AuthMiddleware.isAuthorizedJWT,
      PaymentPlansValidator.validateUpdatePlanData,
      PaymentPlansCtrl.updatePlan
    );
};

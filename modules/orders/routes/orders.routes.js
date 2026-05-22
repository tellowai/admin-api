'use strict';

const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const ordersController = require('../controllers/orders.controller');
const ordersAnalyticsController = require('../controllers/orders.analytics.controller');
const ordersAnalyticsValidator = require('../validators/orders.analytics.validator');

module.exports = function (app) {
  app
    .route('/admin/orders/analytics/status-daily')
    .get(
      AuthMiddleware.isAdminUser,
      ordersAnalyticsValidator.validateOrdersAnalyticsQuery,
      ordersAnalyticsController.getOrdersStatusDaily
    );

  app
    .route('/admin/orders/analytics/status-summary')
    .get(
      AuthMiddleware.isAdminUser,
      ordersAnalyticsValidator.validateOrdersAnalyticsQuery,
      ordersAnalyticsController.getOrdersStatusSummary
    );

  app
    .route('/admin/orders/analytics/volume-summary')
    .get(
      AuthMiddleware.isAdminUser,
      ordersAnalyticsValidator.validateOrdersAnalyticsQuery,
      ordersAnalyticsController.getOrdersVolumeSummary
    );

  app
    .route('/admin/orders/analytics/subscription-purchases-daily')
    .get(
      AuthMiddleware.isAdminUser,
      ordersAnalyticsValidator.validateOrdersAnalyticsQuery,
      ordersAnalyticsController.getSubscriptionPurchasesDaily
    );

  app
    .route('/admin/orders/analytics/purchases-daily')
    .get(
      AuthMiddleware.isAdminUser,
      ordersAnalyticsValidator.validateOrdersAnalyticsQuery,
      ordersAnalyticsController.getPurchasesDaily
    );

  app
    .route('/admin/orders/analytics/user-subscriptions')
    .get(
      AuthMiddleware.isAdminUser,
      ordersAnalyticsValidator.validateUserSubscriptionsTableQuery,
      ordersAnalyticsController.getUserSubscriptionsTable
    );

  app
    .route('/admin/orders/analytics/purchasing-customers')
    .get(
      AuthMiddleware.isAdminUser,
      ordersAnalyticsValidator.validatePurchasingCustomersTableQuery,
      ordersAnalyticsController.getPurchasingCustomersTable
    );

  app.route('/admin/orders/export').get(AuthMiddleware.isAdminUser, ordersController.exportAdminOrdersCsv);

  app
    .route('/admin/orders/play-store')
    .get(AuthMiddleware.isAdminUser, ordersController.listAdminPlayStoreOrders);

  // Unified orphan reconciliation queue (preferred). Required `?gateway=google_play|apple_iap`.
  app
    .route('/admin/orders/orphans')
    .get(AuthMiddleware.isAdminUser, ordersController.listAdminOrphanedOrders);

  app
    .route('/admin/orders/:orderId/google-play/preview-from-console')
    .post(AuthMiddleware.isAdminUser, ordersController.previewGooglePlayFromConsole);

  app
    .route('/admin/orders/:orderId/google-play/fulfill-from-console')
    .post(AuthMiddleware.isAdminUser, ordersController.fulfillGooglePlayFromConsole);

  app.route('/admin/orders').get(AuthMiddleware.isAdminUser, ordersController.listAdminOrders);
};

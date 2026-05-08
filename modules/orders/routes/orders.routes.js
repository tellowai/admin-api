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

  app.route('/admin/orders/export').get(AuthMiddleware.isAdminUser, ordersController.exportAdminOrdersCsv);

  app
    .route('/admin/orders/play-store')
    .get(AuthMiddleware.isAdminUser, ordersController.listAdminPlayStoreOrders);

  app
    .route('/admin/orders/:orderId/google-play/preview-from-console')
    .post(AuthMiddleware.isAdminUser, ordersController.previewGooglePlayFromConsole);

  app
    .route('/admin/orders/:orderId/google-play/fulfill-from-console')
    .post(AuthMiddleware.isAdminUser, ordersController.fulfillGooglePlayFromConsole);

  app.route('/admin/orders').get(AuthMiddleware.isAdminUser, ordersController.listAdminOrders);
};

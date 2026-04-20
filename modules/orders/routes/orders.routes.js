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

  app.route('/admin/orders').get(AuthMiddleware.isAdminUser, ordersController.listAdminOrders);
};

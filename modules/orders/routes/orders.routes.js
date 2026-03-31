'use strict';

const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const ordersController = require('../controllers/orders.controller');

module.exports = function (app) {
  app.route('/admin/orders').get(AuthMiddleware.isAdminUser, ordersController.listAdminOrders);
};

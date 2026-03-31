'use strict';

const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const generationsController = require('../controllers/generations.controller');

module.exports = function (app) {
  // We use AuthMiddleware.isAdminUser to check authorization, mimicking other admin-api routes
  
  app.route('/admin/generations')
    .get(AuthMiddleware.isAdminUser, generationsController.listGenerations);

  app.route('/admin/generations/:mediaGenerationId/credit-transactions')
    .get(AuthMiddleware.isAdminUser, generationsController.getGenerationCreditTransactions);

  app.route('/admin/generations/:mediaGenerationId/node-executions')
    .get(AuthMiddleware.isAdminUser, generationsController.getNodeExecutions);
};

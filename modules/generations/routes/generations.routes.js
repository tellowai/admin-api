'use strict';

const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const generationsController = require('../controllers/generations.controller');

module.exports = function (app) {
  // We use AuthMiddleware.isAdminUser to check authorization, mimicking other admin-api routes
  
  app.route('/api/admin/generations')
    .get(AuthMiddleware.isAdminUser, generationsController.listGenerations);
};

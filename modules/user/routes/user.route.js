'use strict';
const versionConfig = require('../../version');
const AdminUserCtrl = require('../controllers/admin.user.controller');
var AuthMiddleware = require('../../auth/middlewares/auth.middleware');
var AdminUserValidator = require('../validators/admin.user.validator');


module.exports = function (app) {
  
  app.route(
    versionConfig.routePrefix +
    "/admin/users"
  ).post(  
    AuthMiddleware.isAdminUser,
    AdminUserValidator.validateCreateAdminUserData,
    AdminUserCtrl.createNewAdminUserWithSelectRoles
  );

  app.route(
    versionConfig.routePrefix +
    "/admin/users/:userId"
  ).delete(  
    AuthMiddleware.isAdminUser,
    AdminUserCtrl.deleteAdminUser
  );

  app.route(
    versionConfig.routePrefix +
    "/admin/users"
  ).delete(  
    AuthMiddleware.isAdminUser,
    AdminUserValidator.validateBulkRemoveAdminUserData,
    AdminUserCtrl.bulkRemoveAdminUsers
  );

  app.route(
    versionConfig.routePrefix +
    "/admin/users"
  ).get(  
    AuthMiddleware.isAdminUser,
    AdminUserCtrl.getAdminUsersList
  );

  app.route(
    versionConfig.routePrefix +
    "/users/search"
  ).get(  
    AuthMiddleware.isAdminUser,
    AdminUserCtrl.searchAdminUsersByEmail
  );
};

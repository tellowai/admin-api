'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const CustomersLanguagesValidator = require('../validators/customers.languages.validator');
const CustomersLanguagesCtrl = require('../controllers/customers.languages.controller');

module.exports = function (app) {
  app
    .route(versionConfig.routePrefix + '/admin/customers/languages/opted-stats')
    .get(
      AuthMiddleware.isAdminUser,
      CustomersLanguagesValidator.validateContentLanguageOptedStatsQuery,
      CustomersLanguagesCtrl.getContentLanguageOptedStats
    );
};

'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const InfraCostAnalyticsController = require('../controllers/infra-cost.analytics.controller');
const InfraCostValidator = require('../validators/infra-cost.validator');

module.exports = function (app) {
  app
    .route(versionConfig.routePrefix + '/analytics/infra-cost/unit-economics')
    .get(
      AuthMiddleware.isAuthorizedJWT,
      InfraCostValidator.validateUnitEconomicsQuery,
      InfraCostAnalyticsController.getUnitEconomics
    );
};

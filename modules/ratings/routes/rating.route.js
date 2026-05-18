'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const RatingCtrl = require('../controllers/rating.controller');

module.exports = function (app) {
  const prefix = versionConfig.routePrefix + '/admin/ratings';

  app.route(prefix).get(AuthMiddleware.isAdminUser, RatingCtrl.listRatings);
};

'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const SqlRunnerMiddleware = require('../middlewares/sql-runner.middleware');
const SqlRunnerCtrl = require('../controllers/sql-runner.controller');
const Validator = require('../validators/sql-runner.validator');

const prefix = versionConfig.routePrefix + '/admin/sql-runner';

module.exports = function (app) {
  app.post(
    prefix + '/query',
    AuthMiddleware.isAuthorizedJWT,
    SqlRunnerMiddleware.requirePanelAccess,
    Validator.validateRunQuery,
    SqlRunnerCtrl.runQuery,
  );
};

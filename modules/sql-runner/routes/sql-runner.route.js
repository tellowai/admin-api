'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const SqlRunnerCtrl = require('../controllers/sql-runner.controller');
const Validator = require('../validators/sql-runner.validator');

const admin = AuthMiddleware.isAdminUser;
const prefix = versionConfig.routePrefix + '/admin/sql-runner';

module.exports = function (app) {
  app.get(
    prefix + '/databases',
    admin,
    Validator.validateListDatabases,
    SqlRunnerCtrl.listDatabases,
  );

  app.post(
    prefix + '/query',
    admin,
    Validator.validateRunQuery,
    SqlRunnerCtrl.runQuery,
  );
};

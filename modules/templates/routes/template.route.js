'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const TemplateCtrl = require('../controllers/template.controller');

module.exports = function(app) {
  app.route(
    versionConfig.routePrefix + '/templates'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    TemplateCtrl.listTemplates
  );

  app.route(
    versionConfig.routePrefix + '/templates/search'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    TemplateCtrl.searchTemplates
  );
}; 
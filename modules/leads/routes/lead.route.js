'use strict';

const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const LeadCtrl = require('../controllers/lead.controller');

module.exports = function(app) {
  app.route(
    versionConfig.routePrefix + '/leads'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    LeadCtrl.listLeads
  );
  
  app.route(
    versionConfig.routePrefix + '/leads/:leadId'
  ).get(
    AuthMiddleware.isAuthorizedJWT,
    LeadCtrl.getLead
  );
};

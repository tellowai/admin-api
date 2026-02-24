'use strict';
const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const SupportCtrl = require('../controllers/support.controller');

module.exports = function (app) {
  const prefix = versionConfig.routePrefix + "/admin/tickets";

  app.route(prefix)
    .get(AuthMiddleware.isAdminUser, SupportCtrl.listTickets);

  app.route(prefix + "/:ticketId")
    .get(AuthMiddleware.isAdminUser, SupportCtrl.getTicketDetails);

  app.route(prefix + "/:ticketId/assign")
    .put(AuthMiddleware.isAdminUser, SupportCtrl.assignTicket);

  app.route(prefix + "/:ticketId/status")
    .put(AuthMiddleware.isAdminUser, SupportCtrl.updateTicketStatus);

  app.route(prefix + "/:ticketId/resolve")
    .post(AuthMiddleware.isAdminUser, SupportCtrl.resolveTicket);
};

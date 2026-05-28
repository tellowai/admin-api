'use strict';
const versionConfig = require('../../version');
const AuthMiddleware = require('../../auth/middlewares/auth.middleware');
const SupportCtrl = require('../controllers/support.controller');

module.exports = function (app) {
  const prefix = versionConfig.routePrefix + "/admin/tickets";

  app.route(prefix)
    .get(AuthMiddleware.isAdminUser, SupportCtrl.listTickets)
    .post(AuthMiddleware.isAdminUser, SupportCtrl.createTicket);

  app.route(prefix + "/count")
    .get(AuthMiddleware.isAdminUser, SupportCtrl.getTicketsCount);

  app.route(prefix + "/:ticketId")
    .get(AuthMiddleware.isAdminUser, SupportCtrl.getTicketDetails);

  app.route(prefix + "/:ticketId/assign")
    .put(AuthMiddleware.isAdminUser, SupportCtrl.assignTicket);

  app.route(prefix + "/:ticketId/deadline-date")
    .put(AuthMiddleware.isAdminUser, SupportCtrl.updateDeadlineDate);

  app.route(prefix + "/:ticketId/status")
    .put(AuthMiddleware.isAdminUser, SupportCtrl.updateTicketStatus);

  app.route(prefix + "/:ticketId/propose-resolution")
    .post(AuthMiddleware.isAdminUser, SupportCtrl.proposeResolution);

  app.route(prefix + "/:ticketId/close")
    .post(AuthMiddleware.isAdminUser, SupportCtrl.closeTicket);

  app.route(prefix + "/:ticketId/messages")
    .get(AuthMiddleware.isAdminUser, SupportCtrl.getTicketMessages)
    .post(AuthMiddleware.isAdminUser, SupportCtrl.sendTicketMessage);

  app.route(prefix + "/:ticketId/messages/:messageId")
    .delete(AuthMiddleware.isAdminUser, SupportCtrl.deleteTicketMessage);
};

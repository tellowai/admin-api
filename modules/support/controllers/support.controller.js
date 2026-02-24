'use strict';

const SupportService = require('../services/support.service');

exports.listTickets = async function(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const assigned_to = req.query.assigned_to;
    const search = req.query.search;

    const ticketsData = await SupportService.listTickets({ page, limit, status, assigned_to, search });
    return res.status(200).send(ticketsData);
  } catch(err) {
    console.error('List Tickets Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.getTicketDetails = async function(req, res) {
  try {
    const ticketId = req.params.ticketId;
    const ticket = await SupportService.getTicketDetails(ticketId);
    if (!ticket) {
      return res.status(404).send({ message: 'Ticket not found' });
    }
    return res.status(200).send(ticket);
  } catch(err) {
    console.error('Get Ticket Details Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.assignTicket = async function(req, res) {
  try {
    const ticketId = req.params.ticketId;
    const { assigned_to } = req.body;
    await SupportService.assignTicket(ticketId, assigned_to);
    return res.status(200).send({ message: 'Ticket assigned successfully' });
  } catch(err) {
    console.error('Assign Ticket Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.updateTicketStatus = async function(req, res) {
  try {
    const ticketId = req.params.ticketId;
    const { status } = req.body;
    await SupportService.updateTicketStatus(ticketId, status);
    return res.status(200).send({ message: 'Status updated successfully' });
  } catch(err) {
    console.error('Update Ticket Status Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.resolveTicket = async function(req, res) {
  try {
    const ticketId = req.params.ticketId;
    const adminId = req.user.userId;
    const { resolution_notes, is_money_refunded, is_credits_refunded, refunded_credits_type } = req.body;
    if (!resolution_notes) {
      return res.status(400).send({ message: 'Resolution notes required' });
    }
    await SupportService.resolveTicket(ticketId, adminId, resolution_notes, is_money_refunded, is_credits_refunded, refunded_credits_type);
    return res.status(200).send({ message: 'Ticket resolved successfully' });
  } catch(err) {
    console.error('Resolve Ticket Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.getTicketMessages = async function(req, res) {
  try {
    const ticketId = req.params.ticketId;
    const messages = await SupportService.getTicketMessages(ticketId);
    return res.status(200).send({ data: messages });
  } catch(err) {
    console.error('Get Ticket Messages Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.sendTicketMessage = async function(req, res) {
  try {
    const ticketId = req.params.ticketId;
    const adminId = req.user.userId;
    const { message } = req.body;
    if (!message) {
      return res.status(400).send({ message: 'Message content required' });
    }
    const newMessage = await SupportService.sendTicketMessage(ticketId, adminId, message);
    return res.status(200).send({ message: 'Message sent successfully', data: newMessage });
  } catch(err) {
    console.error('Send Ticket Message Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

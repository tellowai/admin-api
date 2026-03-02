'use strict';

const SupportService = require('../services/support.service');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const { TOPICS } = require('../../core/constants/kafka.events.config');

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
    
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'SUPPORT_TICKETS',
          action_name: 'ASSIGN_TICKET', 
          entity_id: ticketId,
          additional_data: JSON.stringify({ assigned_to })
        }
      }],
      'create_admin_activity_log'
    );

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

    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'SUPPORT_TICKETS',
          action_name: 'UPDATE_TICKET_STATUS', 
          entity_id: ticketId,
          additional_data: JSON.stringify({ status })
        }
      }],
      'create_admin_activity_log'
    );

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

    const eventsToLog = [{
      value: { 
        admin_user_id: req.user.userId,
        entity_type: 'SUPPORT_TICKETS',
        action_name: 'RESOLVE_TICKET', 
        entity_id: ticketId,
        additional_data: JSON.stringify({ is_money_refunded, is_credits_refunded })
      }
    }];

    if (is_credits_refunded) {
      eventsToLog.push({
        value: {
          admin_user_id: req.user.userId,
          entity_type: 'SUPPORT_TICKETS',
          action_name: 'TICKET_REFUND_CREDITS',
          entity_id: ticketId,
          additional_data: JSON.stringify({ refunded_credits_type })
        }
      });
    }

    if (is_money_refunded) {
      eventsToLog.push({
        value: {
          admin_user_id: req.user.userId,
          entity_type: 'SUPPORT_TICKETS',
          action_name: 'TICKET_REFUND_MONEY',
          entity_id: ticketId,
          additional_data: JSON.stringify({})
        }
      });
    }

    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      eventsToLog,
      'create_admin_activity_log'
    );

    return res.status(200).send({ message: 'Ticket resolved successfully' });
  } catch(err) {
    console.error('Resolve Ticket Error:', err);
    const errMsg = (err.message || err.originalMessage || '').toString();
    if (errMsg.includes('Cannot refund') || errMsg.includes('already been refunded')) {
      return res.status(400).send({ message: errMsg });
    }
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

    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'SUPPORT_TICKETS',
          action_name: 'SEND_TICKET_MESSAGE', 
          entity_id: ticketId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(200).send({ message: 'Message sent successfully', data: newMessage });
  } catch(err) {
    console.error('Send Ticket Message Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.deleteTicketMessage = async function(req, res) {
  try {
    const { messageId } = req.params;
    const adminId = req.user.userId;
    await SupportService.deleteMessage(messageId, adminId);

    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: req.user.userId,
          entity_type: 'SUPPORT_TICKETS',
          action_name: 'DELETE_TICKET_MESSAGE', 
          entity_id: messageId,
          additional_data: JSON.stringify({ ticketId: req.params.ticketId })
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(200).send({ message: 'Message deleted successfully' });
  } catch(err) {
    if (err.message === 'Message not found') return res.status(404).send({ message: 'Message not found' });
    if (err.message === 'FORBIDDEN') return res.status(403).send({ message: 'You can only delete your own messages' });
    if (err.message === 'ALREADY_READ') return res.status(409).send({ message: 'Message has already been read by the user' });
    if (err.message === 'TOO_OLD') return res.status(409).send({ message: 'Message is older than 30 minutes and cannot be deleted' });
    console.error('Delete Ticket Message Error:', err);
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

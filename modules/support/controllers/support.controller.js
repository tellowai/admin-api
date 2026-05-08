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

exports.getTicketsCount = async function(req, res) {
  try {
    const status = req.query.status || 'submitted';
    const count = await SupportService.getTicketsCountByStatus(status);
    return res.status(200).send({ count });
  } catch(err) {
    console.error('Get Tickets Count Error:', err);
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

exports.updateDeadlineDate = async function(req, res) {
  try {
    const ticketId = req.params.ticketId;
    if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, 'deadline_date')) {
      return res.status(400).send({ message: 'deadline_date is required (string YYYY-MM-DD or null to clear)' });
    }
    const raw = req.body.deadline_date;

    let value = null;
    if (raw === null || raw === undefined || raw === '') {
      value = null;
    } else if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
      value = raw.trim();
    } else {
      return res.status(400).send({ message: 'deadline_date must be YYYY-MM-DD or null/empty to clear' });
    }

    await SupportService.updateDeadlineDate(ticketId, value);

    try {
      await kafkaCtrl.sendMessage(
        TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
        [{
          value: {
            admin_user_id: req.user.userId,
            entity_type: 'SUPPORT_TICKETS',
            action_name: 'UPDATE_TICKET_DEADLINE_DATE',
            entity_id: ticketId,
            additional_data: JSON.stringify({ deadline_date: value })
          }
        }],
        'create_admin_activity_log'
      );
    } catch (kafkaErr) {
      console.error('Update deadline date: activity log (Kafka) failed:', kafkaErr);
    }

    return res.status(200).send({ message: 'Deadline date updated', deadline_date: value });
  } catch (err) {
    if (err && err.message === 'Ticket not found') {
      return res.status(404).send({ message: 'Ticket not found' });
    }
    console.error('Update deadline date error:', err);
    const code = err && err.code;
    const sqlMsg = (err && err.sqlMessage) || '';
    if (code === 'ER_BAD_FIELD_ERROR' && String(sqlMsg).includes('deadline_date')) {
      return res.status(500).send({
        message:
          'Database is missing support_tickets.deadline_date. Apply photobop-db-migrations (20260507170000 alter support tickets deadline) and retry.'
      });
    }
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

exports.proposeResolution = async function(req, res) {
  try {
    const ticketId = req.params.ticketId;
    const adminId = req.user.userId;
    const { resolution_notes, is_money_refunded, is_credits_refunded, refunded_credits_type, refund_credits_amount } =
      req.body;
    if (!resolution_notes) {
      return res.status(400).send({ message: 'Resolution notes required' });
    }
    await SupportService.proposeResolution(
      ticketId,
      adminId,
      resolution_notes,
      is_money_refunded,
      is_credits_refunded,
      refunded_credits_type,
      refund_credits_amount
    );

    const eventsToLog = [
      {
        value: {
          admin_user_id: req.user.userId,
          entity_type: 'SUPPORT_TICKETS',
          action_name: 'PROPOSE_TICKET_RESOLUTION',
          entity_id: ticketId,
          additional_data: JSON.stringify({ is_money_refunded, is_credits_refunded })
        }
      }
    ];

    if (is_credits_refunded) {
      eventsToLog.push({
        value: {
          admin_user_id: req.user.userId,
          entity_type: 'SUPPORT_TICKETS',
          action_name: 'TICKET_REFUND_CREDITS',
          entity_id: ticketId,
          additional_data: JSON.stringify({ refunded_credits_type, refund_credits_amount })
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

    return res.status(200).send({ message: 'Resolution proposed successfully' });
  } catch (err) {
    console.error('Propose resolution error:', err);
    const errMsg = (err.message || err.originalMessage || '').toString();
    if (
      errMsg.includes('Cannot refund') ||
      errMsg.includes('already been refunded') ||
      errMsg.includes('already closed')
    ) {
      return res.status(400).send({ message: errMsg });
    }
    return res.status(500).send({ message: 'Internal Server Error' });
  }
};

exports.closeTicket = async function(req, res) {
  try {
    const ticketId = req.params.ticketId;
    await SupportService.closeTicket(ticketId);

    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [
        {
          value: {
            admin_user_id: req.user.userId,
            entity_type: 'SUPPORT_TICKETS',
            action_name: 'CLOSE_TICKET',
            entity_id: ticketId,
            additional_data: JSON.stringify({})
          }
        }
      ],
      'create_admin_activity_log'
    );

    return res.status(200).send({ message: 'Ticket closed successfully' });
  } catch (err) {
    console.error('Close ticket error:', err);
    const errMsg = (err.message || err.originalMessage || '').toString();
    if (errMsg.includes('already closed')) {
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
    const { message, media } = req.body || {};
    const text = message != null ? String(message).trim() : '';
    if (!text && (!media || !Array.isArray(media) || media.length === 0)) {
      return res.status(400).send({ message: 'Message text or at least one attachment is required' });
    }
    const newMessage = await SupportService.sendTicketMessage(ticketId, adminId, text, media);

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
    if (err && err.message === 'Ticket not found') {
      return res.status(404).send({ message: 'Ticket not found' });
    }
    if (
      err &&
      (err.message === 'Message or attachment required' ||
        err.message === 'Invalid attachment URL' ||
        err.message === 'Invalid attachment asset_key' ||
        err.message === 'Invalid attachment payload' ||
        err.message === 'At most 4 attachments allowed' ||
        err.message === 'Public bucket URL is not configured' ||
        err.message === 'Public bucket is not configured' ||
        err.message === 'Ticket is closed')
    ) {
      return res.status(400).send({ message: err.message });
    }
    console.error('Send Ticket Message Error:', err);
    const code = err && err.code;
    const sqlMsg = (err && err.sqlMessage) || '';
    if (code === 'ER_BAD_FIELD_ERROR' && String(sqlMsg).includes('media')) {
      return res.status(500).send({
        message:
          'Database is missing support_ticket_messages.media. Apply photobop-db-migrations (support ticket messages media column) and retry.'
      });
    }
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

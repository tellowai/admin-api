'use strict';

const SupportModel = require('../models/support.model');

const StorageFactory = require('../../os2/providers/storage.factory');

// A helper to enrich tickets without performing SQL JOINs
async function enrichTicketsWithUsers(tickets) {
  if (!tickets || tickets.length === 0) return [];

  const userIds = new Set();
  tickets.forEach(t => {
    if (t.user_id) userIds.add(t.user_id);
    if (t.assigned_to) userIds.add(t.assigned_to);
  });

  const uniqueUserIds = Array.from(userIds);
  let usersMap = {};
  if (uniqueUserIds.length > 0) {
    const users = await SupportModel.getUsersByIds(uniqueUserIds);
    users.forEach(u => {
      usersMap[u.user_id] = u;
    });
  }

  return tickets.map(t => {
    t.creator = usersMap[t.user_id] || null;
    t.assignee = usersMap[t.assigned_to] || null;
    return t;
  });
}

async function enrichMessagesWithUsers(messages) {
  if (!messages || messages.length === 0) return [];
  const senderIds = new Set();
  messages.forEach(m => {
    if (m.sender_id && m.sender_id !== 'system') senderIds.add(m.sender_id);
  });
  const uniqueSenderIds = Array.from(senderIds);
  let usersMap = {};
  if (uniqueSenderIds.length > 0) {
    const users = await SupportModel.getUsersByIds(uniqueSenderIds);
    users.forEach(u => {
      usersMap[u.user_id] = u;
    });
  }
  return messages.map(m => {
    m.sender = m.sender_id === 'system' ? { first_name: 'Support', last_name: 'Team', email: 'support@kriya.com' } : usersMap[m.sender_id] || { email: m.sender_id };
    return m;
  });
}

exports.listTickets = async function({ page, limit, status, assigned_to, search }) {
  const tickets = await SupportModel.listTickets(page, limit, status, assigned_to, search);
  const total = await SupportModel.countTickets(status, assigned_to, search);
  
  const enrichedTickets = await enrichTicketsWithUsers(tickets);

  return {
    data: enrichedTickets,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  };
};

exports.getTicketDetails = async function(ticketId) {
  const ticket = await SupportModel.getTicketById(ticketId);
  if (!ticket) return null;
  
  const enriched = await enrichTicketsWithUsers([ticket]);
  const finalTicket = enriched[0];

  // Try to find more context if we have a generationId
  if (finalTicket.generation_id) {
    let genContext = {
      source: 'unknown',
      events: [],
      mysqlData: null,
      latestStatus: null,
      payload: null
    };

    // 1. Fetch from ClickHouse
    const events = await SupportModel.getGenerationEventsFromClickHouse(finalTicket.generation_id);
    if (events && events.length > 0) {
      genContext.source = 'clickhouse';
      genContext.events = events;
      genContext.latestStatus = events[0].event_type;
      
      // Try to parse the payload from the first SUBMITTED event
      const submittedEvent = events.find(e => e.event_type === 'SUBMITTED');
      if (submittedEvent && submittedEvent.additional_data) {
        try {
          const parsedData = JSON.parse(submittedEvent.additional_data);
          // additional_data often has { payload: { uploaded_assets: [...] } }
          genContext.payload = parsedData.payload ? parsedData.payload : parsedData;
          
          if (genContext.payload && Array.isArray(genContext.payload.uploaded_assets)) {
            const storage = StorageFactory.getProvider();
            for (let asset of genContext.payload.uploaded_assets) {
              if (asset.asset_key) {
                try {
                  if (asset.asset_bucket && asset.asset_bucket.includes('ephemeral')) {
                    asset.presigned_url = await storage.generateEphemeralPresignedDownloadUrl(asset.asset_key, { expiresIn: 3600 });
                  } else {
                    asset.presigned_url = await storage.generatePresignedDownloadUrl(asset.asset_key, { expiresIn: 3600 });
                  }
                } catch(e) {
                  console.error("Failed to generate presigned URL for asset", asset.asset_key, e);
                }
              }
            }
          }
        } catch(e) {
          console.error("Failed to parse additional_data JSON", e);
        }
      }
    }

    // 2. Try to fetch from MySQL if it's completed
    if (genContext.latestStatus === 'COMPLETED' || genContext.latestStatus === 'FAILED' || events.length === 0) {
      const mysqlData = await SupportModel.getGenerationFromMySQL(finalTicket.generation_id);
      if (mysqlData) {
        genContext.mysqlData = mysqlData;
        genContext.source = 'mysql';
        genContext.latestStatus = mysqlData.job_status || genContext.latestStatus;
      }
    }

    finalTicket.generationContext = genContext;
  }

  return finalTicket;
};

exports.assignTicket = async function(ticketId, assignedToId) {
  const ticket = await SupportModel.getTicketById(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  const updates = { assigned_to: assignedToId };
  if (ticket.status === 'submitted') {
    updates.status = 'in_progress';
  }
  await SupportModel.updateTicket(ticketId, updates);
};

exports.updateTicketStatus = async function(ticketId, status) {
  await SupportModel.updateTicket(ticketId, { status });
};

exports.resolveTicket = async function(ticketId, adminId, resolutionNotes, isMoneyRefunded, isCreditsRefunded, refundedCreditsType) {
  const updates = {
    status: 'resolved',
    resolution_notes: resolutionNotes
  };

  if (isMoneyRefunded) {
    updates.is_money_refunded = true;
  }
  
  if (isCreditsRefunded) {
    updates.is_credits_refunded = true;
    updates.refunded_credits_type = refundedCreditsType;
  }

  await SupportModel.updateTicket(ticketId, updates);
  
  // Also insert the resolution notes as the final message in the conversation
  await SupportModel.insertTicketMessage(ticketId, 'admin', adminId, resolutionNotes);
};

exports.getTicketMessages = async function(ticketId) {
  const messages = await SupportModel.getTicketMessages(ticketId);
  return await enrichMessagesWithUsers(messages);
};

exports.sendTicketMessage = async function(ticketId, adminId, message) {
  const ticket = await SupportModel.getTicketById(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  const messageId = await SupportModel.insertTicketMessage(ticketId, 'admin', adminId, message);
  const newMessage = await SupportModel.getTicketMessageById(messageId);
  
  const enriched = await enrichMessagesWithUsers([newMessage]);
  return enriched[0];
};

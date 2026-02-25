'use strict';

const SupportModel = require('../models/support.model');
const CreditsModel = require('../../../../api/modules/credits/models/credits.model');
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

    // 2. Try to fetch from MySQL using generationId (legacy/fallback)
    if (finalTicket.generation_id) {
      let mysqlData = await SupportModel.getGenerationFromMySQL(finalTicket.generation_id);
      
      // If not in MySQL, build it dynamically from ClickHouse data
      if (!mysqlData && genContext.source === 'clickhouse') {
        mysqlData = {
          media_generation_id: finalTicket.generation_id,
          job_status: genContext.latestStatus?.toLowerCase(),
          output_media_asset_key: null,
          output_media_bucket: null,
          media_type: null
        };
        
        // Try getting accurate properties from resource_generations in ClickHouse
        const clickHouseGen = await SupportModel.getResourceGenerationFromClickHouse(finalTicket.generation_id);
        if (clickHouseGen && clickHouseGen.media_type) {
           mysqlData.media_type = clickHouseGen.media_type;
        }

        // Try getting output from completed event
        const completedEvent = genContext.events.find(e => e.event_type === 'COMPLETED');
        if (completedEvent && completedEvent.additional_data) {
          try {
            const parsed = JSON.parse(completedEvent.additional_data);
            if (parsed.output) {
              mysqlData.output_media_asset_key = parsed.output.asset_key;
              mysqlData.output_media_bucket = parsed.output.asset_bucket;
            }
          } catch(e) { console.error('Failed to parse clickhouse output', e) }
        }
      }

      if (mysqlData) {
        genContext.mysqlData = mysqlData;
        genContext.source = genContext.source === 'clickhouse' ? 'clickhouse' : 'mysql';
        genContext.latestStatus = mysqlData.job_status || genContext.latestStatus;

        // Generate a presigned URL for the output media file
        if (mysqlData.output_media_asset_key) {
          try {
            const storage = StorageFactory.getProvider();
            let isEphemeral = false;
            
            if (mysqlData.output_media_bucket && mysqlData.output_media_bucket.includes('ephemeral')) {
              isEphemeral = true;
            } else if (mysqlData.output_media_asset_key.includes('ephemeral')) {
              isEphemeral = true;
            }

            genContext.mysqlData.output_media_url = isEphemeral
              ? await storage.generateEphemeralPresignedDownloadUrl(mysqlData.output_media_asset_key, { expiresIn: 3600 })
              : await storage.generatePresignedDownloadUrl(mysqlData.output_media_asset_key, { expiresIn: 3600 });
          } catch(e) {
            console.error('Failed to generate presigned URL for output media', e);
          }
        }
      }
    }

    if (finalTicket.generation_id) {
      genContext.credits_deducted = await SupportModel.getDeductedCreditsForGeneration(finalTicket.generation_id);
      genContext.credits_refunded = await SupportModel.getRefundedCreditsForGeneration(finalTicket.generation_id);
      genContext.other_tickets_count = await SupportModel.countOtherTicketsForGeneration(finalTicket.generation_id, finalTicket.ticket_id);
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
  const ticket = await SupportModel.getTicketById(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  const updates = {
    status: 'resolved',
    resolution_notes: resolutionNotes
  };

  if (isMoneyRefunded) {
    updates.is_money_refunded = true;
  }
  
  if (isCreditsRefunded) {
    if (ticket.is_credits_refunded) {
      throw new Error('Credits have already been refunded for this ticket.');
    }
    
    // We only refund if there is a generation_id and credits were actually deducted
    if (!ticket.generation_id) {
      throw new Error('Cannot refund credits: No generation attached to this ticket.');
    }

    const deductedAmount = await SupportModel.getDeductedCreditsForGeneration(ticket.generation_id);
    if (!deductedAmount || deductedAmount <= 0) {
      throw new Error('Cannot refund credits: No credits were deducted for this generation.');
    }

    const previouslyRefundedAmount = await SupportModel.getRefundedCreditsForGeneration(ticket.generation_id);
    if (previouslyRefundedAmount > 0) {
      throw new Error('Credits have already been refunded for this generation.');
    }

    // Process the refund securely via CreditsModel
    const description = `Refund for support ticket #${ticketId} (Generation: ${ticket.generation_id})`;
    await CreditsModel.refundCreditsTransaction(
      ticket.user_id,
      deductedAmount,
      'adjustment',
      ticket.generation_id,
      description
    );

    updates.is_credits_refunded = true;
    updates.refunded_credits_type = 'new';
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

exports.deleteMessage = async function(messageId, adminId) {
  const msg = await SupportModel.getTicketMessageById(messageId);
  if (!msg) throw new Error('Message not found');
  if (msg.sender_type !== 'admin' || msg.sender_id !== adminId) throw new Error('FORBIDDEN');
  if (msg.read_at) throw new Error('ALREADY_READ');

  const ageMs = Date.now() - new Date(msg.created_at).getTime();
  if (ageMs > 30 * 60 * 1000) throw new Error('TOO_OLD');

  await SupportModel.deleteMessage(messageId);
};

'use strict';

const SupportModel = require('../models/support.model');
const TemplateModel = require('../../templates/models/template.model');
const AdminUserModel = require('../../user/models/admin.user.model');
const StorageFactory = require('../../os2/providers/storage.factory');
const CreditsModel = require('../../credits/models/credits.model');
const EntitlementsModel = require('../../entitlements/models/entitlements.model');
const fcmSupportNotify = require('./fcm.support.notify.service');
const config = require('../../../config/config');

const MAX_CHAT_ATTACHMENTS = 4;

/** Origins where public-bucket chat attachments may be hosted (CDN + direct R2 URL from presigned PUT). */
function getAllowedPublicAttachmentOrigins() {
  const origins = new Set();
  const bucketUrlRaw = String(config.os2?.r2?.public?.bucketUrl || '').trim();
  if (bucketUrlRaw) {
    try {
      origins.add(new URL(bucketUrlRaw).origin);
    } catch {
      /* ignore */
    }
  }
  const bucket = String(config.os2?.r2?.public?.bucket || '').trim();
  const endpointRaw = String(
    config.os2?.r2?.public?.endpoint || config.os2?.r2?.endpoint || ''
  ).trim();
  if (bucket && endpointRaw) {
    try {
      const host = new URL(endpointRaw).hostname;
      origins.add(new URL(`https://${bucket}.${host}`).origin);
    } catch {
      /* ignore */
    }
  }
  return origins;
}

function truncateForPush(text, maxLen = 140) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return 'You have a new message from support.';
  return s.length <= maxLen ? s : `${s.slice(0, maxLen - 1)}…`;
}

function parseMessageMediaField(m) {
  if (!m || m.media == null || m.media === '') {
    if (m) m.media = null;
    return;
  }
  if (typeof m.media === 'string') {
    try {
      m.media = JSON.parse(m.media);
    } catch {
      m.media = null;
      return;
    }
  }
  if (!Array.isArray(m.media)) {
    m.media = null;
  }
}

/** Strip optional `/{bucket}/` prefix from R2 pathname, return `assets/...` key or null. */
function extractPublicAssetKeyFromUrl(urlStr, publicBucket) {
  try {
    const u = new URL(urlStr);
    let path = u.pathname.replace(/^\/+/, '');
    if (publicBucket) {
      const prefixed = `${publicBucket}/`;
      if (path.startsWith(prefixed)) path = path.slice(prefixed.length);
    }
    if (path.includes('..')) return null;
    if (path.startsWith('assets/')) return path;
  } catch {
    return null;
  }
  return null;
}

function normalizePublicAssetsPrefix() {
  const p = String(config.os2?.r2?.assetsPrefix || 'assets/').replace(/^\/+/, '');
  return p.endsWith('/') ? p : `${p}/`;
}

/**
 * Add `url` for clients; keep `asset_key` + `bucket` from DB. Fixes legacy rows that only stored direct URLs.
 * @param {unknown} mediaArr
 * @returns {unknown}
 */
function expandSupportMessageMediaForClient(mediaArr) {
  if (!Array.isArray(mediaArr) || mediaArr.length === 0) return mediaArr;
  const publicBucket = String(config.os2?.r2?.public?.bucket || '').trim();
  const base = String(config.os2?.r2?.public?.bucketUrl || '').trim().replace(/\/$/, '');

  return mediaArr.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const type = item.type === 'video' ? 'video' : 'image';

    if (item.asset_key) {
      const asset_key = String(item.asset_key).replace(/^\/+/, '');
      const bucket = item.bucket || publicBucket;
      const url = base && asset_key ? `${base}/${asset_key}` : item.url || null;
      return { asset_key, bucket, type, ...(url ? { url } : {}) };
    }

    if (item.url) {
      const legacyUrl = String(item.url).trim();
      const asset_key = extractPublicAssetKeyFromUrl(legacyUrl, publicBucket);
      const url = asset_key && base ? `${base}/${asset_key}` : legacyUrl;
      return {
        asset_key: asset_key || undefined,
        bucket: publicBucket || item.bucket,
        type,
        url
      };
    }

    return item;
  });
}

/**
 * Persist public-bucket chat media as `{ asset_key, bucket, type }` (no URLs in DB).
 * Accepts `{ asset_key, type }` or legacy `{ url, type }` from older clients.
 * @param {unknown} mediaInput
 * @returns {Array<{ asset_key: string, bucket: string, type: 'image'|'video' }>|null}
 */
function normalizeAdminMediaPayload(mediaInput) {
  if (mediaInput == null) return null;
  const arr = Array.isArray(mediaInput) ? mediaInput : [];
  if (arr.length === 0) return null;
  if (arr.length > MAX_CHAT_ATTACHMENTS) {
    throw new Error(`At most ${MAX_CHAT_ATTACHMENTS} attachments allowed`);
  }

  const publicBucket = String(config.os2?.r2?.public?.bucket || '').trim();
  if (!publicBucket) {
    throw new Error('Public bucket is not configured');
  }

  const prefix = normalizePublicAssetsPrefix();
  const allowedOrigins = getAllowedPublicAttachmentOrigins();
  const out = [];

  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;

    const akInput = item.asset_key != null ? String(item.asset_key).trim().replace(/^\/+/, '') : '';
    const urlInput = item.url != null ? String(item.url).trim() : '';

    let asset_key = akInput;
    if (!asset_key && urlInput) {
      if (allowedOrigins.size === 0) {
        throw new Error('Public bucket URL is not configured');
      }
      let origin;
      try {
        origin = new URL(urlInput).origin;
      } catch {
        throw new Error('Invalid attachment URL');
      }
      if (!allowedOrigins.has(origin)) {
        throw new Error('Invalid attachment URL');
      }
      asset_key = extractPublicAssetKeyFromUrl(urlInput, publicBucket);
      if (!asset_key) {
        throw new Error('Invalid attachment URL');
      }
    }

    if (!asset_key || asset_key.includes('..')) {
      throw new Error('Invalid attachment asset_key');
    }
    if (!asset_key.startsWith(prefix)) {
      throw new Error('Invalid attachment asset_key');
    }

    const rawType = item.type != null ? String(item.type).toLowerCase() : '';
    const type = rawType === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(asset_key) ? 'video' : 'image';
    const bucket = item.bucket && String(item.bucket).trim() ? String(item.bucket).trim() : publicBucket;

    out.push({ asset_key, bucket, type });
  }

  if (arr.length > 0 && out.length === 0) {
    throw new Error('Invalid attachment payload');
  }
  return out.length ? out : null;
}

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

    // Generate presigned URLs for user-uploaded profile photos
    const storage = StorageFactory.getProvider();
    await Promise.all(users.map(async (u) => {
      if (u.profile_pic_bucket && u.profile_pic_asset_key) {
        try {
          if (u.profile_pic_bucket.includes('ephemeral')) {
            u.profile_pic = await storage.generateEphemeralPresignedDownloadUrl(u.profile_pic_asset_key, { expiresIn: 3600 });
          } else {
            u.profile_pic = await storage.generatePresignedDownloadUrl(u.profile_pic_asset_key, { expiresIn: 3600 });
          }
        } catch(e) {
          // Fall back to the stored profile_pic URL (e.g. Google/Facebook profile photo)
        }
      }
    }));

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
    parseMessageMediaField(m);
    if (m.media && Array.isArray(m.media)) {
      m.media = expandSupportMessageMediaForClient(m.media);
    }
    m.sender = m.sender_id === 'system' ? { first_name: 'Support', last_name: 'Team', email: 'support@kriya.com' } : usersMap[m.sender_id] || { email: m.sender_id };
    return m;
  });
}

exports.createTicketFromAdmin = async function ({ userId, message, adminId }) {
  const users = await SupportModel.getUsersByIds([userId]);
  if (!users.length) {
    throw new Error('User not found');
  }

  const existing = await SupportModel.findActiveTicketByUserId(userId);
  if (existing) {
    const err = new Error('ACTIVE_TICKET_EXISTS');
    err.ticketId = existing.ticket_id;
    throw err;
  }

  const text = message != null ? String(message).trim() : '';
  if (!text) {
    throw new Error('Message required');
  }

  const ticketId = await SupportModel.insertTicket({
    userId,
    reason: text,
    generationId: null,
    templateId: null,
    metadata: null
  });

  const ticket = await SupportModel.getTicketById(ticketId);
  await SupportModel.insertTicketMessage(ticketId, 'admin', adminId, text, null);
  await autoAssignTicketToMessagingAdmin(ticketId, ticket, adminId);

  void fcmSupportNotify.notifyUserSupportReply(userId, ticketId, {
    title: 'Support',
    body: truncateForPush(text)
  });

  return { ticket_id: ticketId };
};

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

exports.getTicketsCountByStatus = async function(status) {
  return await SupportModel.countTickets(status);
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

    // 1. Fetch MySQL data first — the ticket's generation_id is the MySQL media_generation_id.
    //    The real ClickHouse resource_generation_id is stored inside output_metadata.generation_id.
    const mysqlData = await SupportModel.getGenerationFromMySQL(finalTicket.generation_id);

    // Extract the ClickHouse resource_generation_id from MySQL's output_metadata.
    // Fall back to the ticket's generation_id for ClickHouse-native generations (no MySQL record).
    let chGenerationId = finalTicket.generation_id;
    if (mysqlData) {
      genContext.mysqlData = mysqlData;
      genContext.source = 'mysql';
      genContext.latestStatus = mysqlData.job_status;

      // output_metadata may be a JSON string or already an object
      let outputMeta = mysqlData.output_metadata;
      if (typeof outputMeta === 'string') {
        try { outputMeta = JSON.parse(outputMeta); } catch(_) {}
      }
      if (outputMeta?.generation_id) {
        chGenerationId = outputMeta.generation_id;
        console.log('[Support] MySQL generation_id:', finalTicket.generation_id, '→ ClickHouse resource_generation_id:', chGenerationId);
      }
    }

    // 2. Query ClickHouse events using the correct resource_generation_id
    const events = await SupportModel.getGenerationEventsFromClickHouse(chGenerationId);
    if (events && events.length > 0) {
      genContext.source = 'clickhouse';
      genContext.events = events;
      genContext.latestStatus = events[0].event_type;

      // Parse the SUBMITTED event to extract uploaded_assets and payload
      const submittedEvent = events.find(e => e.event_type === 'SUBMITTED');
      if (submittedEvent && submittedEvent.additional_data) {
        try {
          const parsedData = JSON.parse(submittedEvent.additional_data);
          // additional_data has shape: { payload: { uploaded_assets: [...], ... }, user_id, template_id, ... }
          genContext.payload = parsedData.payload ? parsedData.payload : parsedData;

          // Fallback 1: legacy events stored uploaded_assets at the top level (not in payload)
          if (!genContext.payload.uploaded_assets && Array.isArray(parsedData.uploaded_assets)) {
            genContext.payload.uploaded_assets = parsedData.uploaded_assets;
          }

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
                  console.error('Failed to generate presigned URL for asset', asset.asset_key, e);
                }
              }
            }
          }
        } catch(e) {
          console.error('Failed to parse SUBMITTED event additional_data JSON', e);
        }
      }
    }

    // 3. Fetch resource_generations record for media_type and additional_data
    const clickHouseGen = await SupportModel.getResourceGenerationFromClickHouse(chGenerationId);
    if (mysqlData && clickHouseGen && clickHouseGen.media_type) {
      mysqlData.media_type = clickHouseGen.media_type;
    } else if (!mysqlData && clickHouseGen) {
      // ClickHouse-native generation — build a minimal mysqlData substitute
      genContext.mysqlData = {
        media_generation_id: finalTicket.generation_id,
        job_status: genContext.latestStatus?.toLowerCase(),
        output_media_asset_key: null,
        output_media_bucket: null,
        media_type: clickHouseGen.media_type || null
      };
    }

    // Try getting output key from COMPLETED event (ClickHouse-native or MySQL with no output key yet)
    if (genContext.mysqlData && !genContext.mysqlData.output_media_asset_key) {
      const completedEvent = genContext.events.find(e => e.event_type === 'COMPLETED');
      if (completedEvent && completedEvent.additional_data) {
        try {
          const parsed = JSON.parse(completedEvent.additional_data);
          if (parsed.output) {
            genContext.mysqlData.output_media_asset_key = parsed.output.asset_key;
            genContext.mysqlData.output_media_bucket = parsed.output.asset_bucket;
          }
        } catch(e) { console.error('Failed to parse COMPLETED event additional_data', e); }
      }
    }

    // Fallback 2: If uploaded_assets still missing, read from resource_generations.additional_data
    if (!genContext.payload?.uploaded_assets || genContext.payload.uploaded_assets.length === 0) {
      try {
        if (clickHouseGen?.additional_data) {
          const genAdditionalData = typeof clickHouseGen.additional_data === 'string'
            ? JSON.parse(clickHouseGen.additional_data)
            : clickHouseGen.additional_data;

          if (Array.isArray(genAdditionalData.uploaded_assets) && genAdditionalData.uploaded_assets.length > 0) {
            if (!genContext.payload) genContext.payload = {};
            genContext.payload.uploaded_assets = genAdditionalData.uploaded_assets;

            const storage = StorageFactory.getProvider();
            for (let asset of genContext.payload.uploaded_assets) {
              if (asset.asset_key && !asset.presigned_url) {
                try {
                  if (asset.asset_bucket && asset.asset_bucket.includes('ephemeral')) {
                    asset.presigned_url = await storage.generateEphemeralPresignedDownloadUrl(asset.asset_key, { expiresIn: 3600 });
                  } else {
                    asset.presigned_url = await storage.generatePresignedDownloadUrl(asset.asset_key, { expiresIn: 3600 });
                  }
                } catch(e) {
                  console.error('Fallback: Failed to generate presigned URL for asset', asset.asset_key, e);
                }
              }
            }
          }
        }
      } catch(e) {
        console.error('Fallback: Failed to read uploaded_assets from resource_generations.additional_data', e);
      }
    }

    // Generate presigned URL for the output media
    if (genContext.mysqlData?.output_media_asset_key) {
      try {
        const storage = StorageFactory.getProvider();
        const isEphemeral = (genContext.mysqlData.output_media_bucket?.includes('ephemeral')) ||
                            (genContext.mysqlData.output_media_asset_key?.includes('ephemeral'));
        genContext.mysqlData.output_media_url = isEphemeral
          ? await storage.generateEphemeralPresignedDownloadUrl(genContext.mysqlData.output_media_asset_key, { expiresIn: 3600 })
          : await storage.generatePresignedDownloadUrl(genContext.mysqlData.output_media_asset_key, { expiresIn: 3600 });
      } catch(e) {
        console.error('Failed to generate presigned URL for output media', e);
      }
    }

    genContext.credits_deducted = await SupportModel.getDeductedCreditsForGeneration(finalTicket.generation_id);
    genContext.credits_refunded = await SupportModel.getRefundedCreditsForGeneration(finalTicket.generation_id);
    genContext.credits_auto_refunded = await SupportModel.getReleasedCreditsForGeneration(finalTicket.generation_id);
    genContext.other_tickets_count = await SupportModel.countOtherTicketsForGeneration(finalTicket.generation_id, finalTicket.ticket_id);
    genContext.transactions = await SupportModel.getTransactionsForGeneration(finalTicket.generation_id);

    finalTicket.generationContext = genContext;
  }

  if (finalTicket.template_id) {
    try {
      const template = await TemplateModel.getTemplateById(finalTicket.template_id);
      if (template) {
        finalTicket.template_name = template.template_name || 'Unknown Template';
        finalTicket.template = template;
      }
    } catch(e) {
      console.error('Failed to fetch template details for ticket', e);
    }
  }

  if (finalTicket.user_id) {
    const balanceData = await SupportModel.getUserBalance(finalTicket.user_id);
    finalTicket.user_credits = balanceData;
    try {
      finalTicket.template_slots_remaining_total = await EntitlementsModel.sumTemplateSlotsRemainingByUserId(
        finalTicket.user_id
      );
    } catch (e) {
      console.error('Failed to load entitlement slots total for ticket', e);
      finalTicket.template_slots_remaining_total = 0;
    }
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

/** @param {string|null} dateOrNull — `YYYY-MM-DD` or null to clear */
exports.updateDeadlineDate = async function(ticketId, dateOrNull) {
  const ticket = await SupportModel.getTicketById(ticketId);
  if (!ticket) throw new Error('Ticket not found');
  await SupportModel.updateTicket(ticketId, { deadline_date: dateOrNull });
};

/**
 * When an admin contacts the customer, assign the ticket to that admin (and move submitted → in_progress).
 * No-op if the ticket is already resolved.
 * @param {object} ticket — row from `getTicketById`
 */
async function autoAssignTicketToMessagingAdmin(ticketId, ticket, adminId) {
  if (!ticket || ticket.status === 'resolved') return;
  const updates = { assigned_to: adminId };
  if (ticket.status === 'submitted') {
    updates.status = 'in_progress';
  }
  await SupportModel.updateTicket(ticketId, updates);
}

exports.updateTicketStatus = async function(ticketId, status) {
  await SupportModel.updateTicket(ticketId, { status });
};

/**
 * Apply optional credit refund to a ticket row (mutates `updates`).
 * @param {object} ticket — row from `getTicketById`
 * @param {string} ticketId
 * @param {Record<string, unknown>} updates — fields passed to `updateTicket`
 * @param {boolean} isCreditsRefunded
 * @param {number|null|undefined} refundCreditsAmount
 */
async function applyCreditsRefundIfRequested(ticket, ticketId, updates, isCreditsRefunded, refundCreditsAmount) {
  if (!isCreditsRefunded) return;

  if (ticket.is_credits_refunded) {
    throw new Error('Credits have already been refunded for this ticket.');
  }

  if (!ticket.generation_id) {
    throw new Error('Cannot refund credits: No generation attached to this ticket.');
  }

  const deductedAmount = await SupportModel.getDeductedCreditsForGeneration(ticket.generation_id);
  const amountToRefund =
    refundCreditsAmount != null && Number(refundCreditsAmount) > 0
      ? Number(refundCreditsAmount)
      : deductedAmount;

  if (!amountToRefund || amountToRefund <= 0) {
    throw new Error(
      refundCreditsAmount != null
        ? 'Credits to refund must be a positive number.'
        : 'Cannot refund credits: No credits were deducted for this generation. For à la carte, enter the number of credits to refund.'
    );
  }

  const previouslyRefundedAmount = await SupportModel.getRefundedCreditsForGeneration(ticket.generation_id);
  if (previouslyRefundedAmount > 0) {
    throw new Error('Credits have already been refunded for this generation.');
  }

  const description = `Refund for support ticket #${ticketId} (Generation: ${ticket.generation_id})`;
  await CreditsModel.refundCreditsTransaction(
    ticket.user_id,
    amountToRefund,
    'adjustment',
    ticket.generation_id,
    description
  );

  updates.is_credits_refunded = true;
  updates.refunded_credits_type = 'new';
}

/**
 * Post resolution notes to the ticket (DB + thread), optional refunds. Does **not** set status to resolved.
 * Assigns the ticket to the acting admin and moves `submitted` → `in_progress` when applicable.
 */
exports.proposeResolution = async function (
  ticketId,
  adminId,
  resolutionNotes,
  isMoneyRefunded,
  isCreditsRefunded,
  _refundedCreditsType,
  refundCreditsAmount
) {
  const ticket = await SupportModel.getTicketById(ticketId);
  if (!ticket) throw new Error('Ticket not found');
  if (ticket.status === 'resolved') {
    throw new Error('Ticket is already closed.');
  }

  const updates = {
    resolution_notes: resolutionNotes,
    assigned_to: adminId
  };
  if (ticket.status === 'submitted') {
    updates.status = 'in_progress';
  }

  if (isMoneyRefunded) {
    updates.is_money_refunded = true;
  }

  await applyCreditsRefundIfRequested(ticket, ticketId, updates, isCreditsRefunded, refundCreditsAmount);

  await SupportModel.updateTicket(ticketId, updates);
  await SupportModel.insertTicketMessage(ticketId, 'admin', adminId, resolutionNotes, null);
  void fcmSupportNotify.notifyUserSupportReply(ticket.user_id, ticketId, {
    title: 'Support update',
    body: truncateForPush(resolutionNotes),
  });
};

/**
 * Mark ticket resolved only (no resolution message, no refunds).
 */
exports.closeTicket = async function (ticketId) {
  const ticket = await SupportModel.getTicketById(ticketId);
  if (!ticket) throw new Error('Ticket not found');
  if (ticket.status === 'resolved') {
    throw new Error('Ticket is already closed.');
  }
  await SupportModel.updateTicket(ticketId, { status: 'resolved' });
};

exports.getTicketMessages = async function(ticketId) {
  const messages = await SupportModel.getTicketMessages(ticketId);
  return await enrichMessagesWithUsers(messages);
};

exports.sendTicketMessage = async function(ticketId, adminId, messageText, mediaInput) {
  const ticket = await SupportModel.getTicketById(ticketId);
  if (!ticket) throw new Error('Ticket not found');
  if (ticket.status === 'resolved') {
    throw new Error('Ticket is closed');
  }

  const text = messageText != null ? String(messageText).trim() : '';
  const mediaPayload = normalizeAdminMediaPayload(mediaInput);
  if (!text && !mediaPayload) {
    throw new Error('Message or attachment required');
  }

  const messageId = await SupportModel.insertTicketMessage(ticketId, 'admin', adminId, text || '', mediaPayload);
  await autoAssignTicketToMessagingAdmin(ticketId, ticket, adminId);

  const newMessage = await SupportModel.getTicketMessageById(messageId);

  const enriched = await enrichMessagesWithUsers([newMessage]);
  const pushBody = text || (mediaPayload && mediaPayload.length ? 'Sent an attachment' : '');
  void fcmSupportNotify.notifyUserSupportReply(ticket.user_id, ticketId, {
    title: 'Support',
    body: truncateForPush(pushBody),
  });
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

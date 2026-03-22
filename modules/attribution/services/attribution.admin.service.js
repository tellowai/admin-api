'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const TrackingLinkModel = require('../models/tracking_link.model');
const { invalidateDeferredLinkCache } = require('./attribution.deferred.redis.service');
const InfluencerModel = require('../models/influencer_profile.model');
const AttributionChModel = require('../models/attribution_ch.model');

const SHORT_CODE_RE = /^[a-z0-9][a-z0-9-_]{1,48}$/i;
const PROVIDER_RE = /^[a-z0-9][a-z0-9_.-]{0,48}$/i;

/** Allowlisted platform keys for profile_urls. Add new platforms here – no DB migration needed. */
const PROFILE_URL_PLATFORMS = new Set(['instagram', 'youtube', 'twitter', 'tiktok', 'linkedin', 'facebook']);
const URL_RE = /^https?:\/\/[^\s]+$/i;

function normalizeUrl(u) {
  const s = String(u).trim();
  if (!s) return null;
  if (URL_RE.test(s)) return s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(s) || s.includes('.')) return 'https://' + s.replace(/^\/+/, '');
  return null;
}

function normalizeProfileUrls(val) {
  if (val == null) return null;
  if (typeof val !== 'object' || Array.isArray(val)) return null;
  const out = {};
  for (const [key, url] of Object.entries(val)) {
    const k = String(key).trim().toLowerCase();
    if (!PROFILE_URL_PLATFORMS.has(k)) continue;
    const u = normalizeUrl(url);
    if (!u) continue;
    out[k] = u;
  }
  return Object.keys(out).length ? out : null;
}

function parseProfileUrlsFromRow(row) {
  if (row == null) return {};
  const raw = row.profile_urls;
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function validateShortCode(code) {
  if (!code || typeof code !== 'string') return false;
  return SHORT_CODE_RE.test(code.trim());
}

/** Generate a unique short_code (10 hex chars). Caller must check DB uniqueness. */
function generateShortCode() {
  return crypto.randomBytes(5).toString('hex');
}

async function resolveShortCodeForCreate(payload) {
  const raw = payload.short_code != null ? String(payload.short_code).trim() : '';
  if (raw) {
    if (!validateShortCode(raw)) {
      const err = new Error('Invalid short_code (2-50 chars, alphanumeric, hyphen, underscore)');
      err.statusCode = 400;
      throw err;
    }
    const normalized = raw.toLowerCase();
    const existing = await TrackingLinkModel.getByShortCode(normalized);
    if (existing) {
      const err = new Error('short_code already exists');
      err.statusCode = 409;
      throw err;
    }
    return normalized;
  }
  let shortCode = generateShortCode();
  for (let i = 0; i < 20; i++) {
    const existing = await TrackingLinkModel.getByShortCode(shortCode);
    if (!existing) return shortCode;
    shortCode = generateShortCode();
  }
  const err = new Error('Unable to generate unique short_code');
  err.statusCode = 500;
  throw err;
}

function normalizeProvider(val, fallback) {
  if (val == null || val === '') return fallback;
  if (typeof val !== 'string') {
    const err = new Error('Invalid attribution_provider');
    err.statusCode = 400;
    throw err;
  }
  const s = val.trim().toLowerCase();
  if (!PROVIDER_RE.test(s)) {
    const err = new Error('Invalid attribution_provider (e.g. internal, branch, appsflyer)');
    err.statusCode = 400;
    throw err;
  }
  return s;
}

/** Parse DB platform (comma-separated) into array; backward compat for single value. */
function platformsArrayFromString(platform) {
  if (platform == null || platform === '') return [];
  const s = String(platform).trim();
  if (!s) return [];
  return s.split(',').map((p) => p.trim()).filter(Boolean);
}

/** Serialize platforms array for DB; accepts string (single) or array. */
function platformStringFromPayload(platformsOrString) {
  if (platformsOrString == null) return null;
  if (Array.isArray(platformsOrString)) {
    const joined = platformsOrString.map((p) => String(p).trim()).filter(Boolean).join(',');
    return joined || null;
  }
  const s = String(platformsOrString).trim();
  return s || null;
}

/** Add platforms array and normalized profile_urls object to raw profile row for API response. */
function serializeInfluencer(row) {
  if (!row) return row;
  return {
    ...row,
    platforms: platformsArrayFromString(row.platform),
    profile_urls: parseProfileUrlsFromRow(row)
  };
}

/** all | ios | android — filters attribution event counts (not link clicks). */
function normalizeDeviceOs(query) {
  if (!query || query == null) return 'all';
  const raw = query.device_os != null ? query.device_os : query.app_os;
  if (raw == null || raw === '') return 'all';
  const v = String(raw).toLowerCase().trim();
  if (v === 'ios' || v === 'android') return v;
  return 'all';
}

/**
 * ClickHouse analytics for one or more tracking link ids (object_id in raw events).
 * Installs chart is install-only; attribution_events includes all types (e.g. attributed_purchase + revenue);
 * purchases_by_day is ready when the app sends authenticated attributed_purchase events.
 */
async function buildAnalyticsForLinks(linkIds, startDate, endDate, osFilter) {
  const startTs = `${startDate} 00:00:00`;
  const endTs = `${endDate} 23:59:59`;
  const os = osFilter === 'ios' || osFilter === 'android' ? osFilter : null;
  if (!linkIds || !linkIds.length) {
    return {
      clicks_total: 0,
      attribution_events: [],
      installs_by_day: [],
      purchases_by_day: [],
      events_by_plan: [],
      signups_by_auth_occasion: [],
      device_os: os || 'all',
      funnel_by_os: [],
      installs_by_os: [],
      attribution_by_channel: [],
      clicks_by_channel: [],
      purchase_repeat_summary: {
        repeat_buyers_distinct_users: 0,
        purchase_events_total: 0,
        purchase_events_tagged_first: 0,
        purchase_events_tagged_repeat: 0
      }
    };
  }
  const [
    clicks,
    events,
    installsByDay,
    purchasesByDay,
    eventsByPlan,
    signupsByAuthOccasion,
    funnelByOs,
    installsByOs,
    attributionByChannel,
    clicksByChannel,
    purchaseRepeatSummary
  ] = await Promise.all([
    AttributionChModel.queryClickCountForLinkIds(linkIds, startTs, endTs),
    AttributionChModel.queryAttributionEventsForObjectIds(linkIds, startDate, endDate, os),
    AttributionChModel.queryInstallsByDayForObjectIds(linkIds, startDate, endDate, os),
    AttributionChModel.queryPurchasesByDayForObjectIds(linkIds, startDate, endDate, os),
    AttributionChModel.queryAttributionEventsByPlanForObjectIds(linkIds, startDate, endDate, os),
    AttributionChModel.querySignupsByAuthOccasionForObjectIds(linkIds, startDate, endDate, os),
    AttributionChModel.queryFunnelMetricsByOsForObjectIds(linkIds, startDate, endDate),
    AttributionChModel.queryInstallsByOsForObjectIds(linkIds, startDate, endDate, os),
    AttributionChModel.queryAttributionByChannelFromRawForObjectIds(linkIds, startDate, endDate, os),
    AttributionChModel.queryClicksByChannelForLinkIds(linkIds, startTs, endTs),
    AttributionChModel.queryPurchaseRepeatSummaryForObjectIds(linkIds, startDate, endDate, os)
  ]);
  return {
    clicks_total: clicks.total,
    attribution_events: events,
    installs_by_day: installsByDay,
    purchases_by_day: purchasesByDay,
    events_by_plan: eventsByPlan,
    signups_by_auth_occasion: signupsByAuthOccasion,
    device_os: os || 'all',
    funnel_by_os: funnelByOs,
    installs_by_os: installsByOs,
    attribution_by_channel: attributionByChannel,
    clicks_by_channel: clicksByChannel,
    purchase_repeat_summary: purchaseRepeatSummary
  };
}

/**
 * Get paginated timeline of individual attribution events for link(s) or profile.
 * Stitches clicks and attribution events in service layer (no joins/subqueries in model).
 */
exports.getAttributionEventsTimeline = async function (objectIds, query) {
  const startDate = query.start_date || query.startDate;
  const endDate = query.end_date || query.endDate;
  if (!startDate || !endDate) {
    const err = new Error('start_date and end_date are required (YYYY-MM-DD)');
    err.statusCode = 400;
    throw err;
  }
  if (!objectIds || !Array.isArray(objectIds) || !objectIds.length) {
    return { events: [], total: 0, limit: 50, offset: 0 };
  }
  const limit = Math.max(1, Math.min(Number(query.limit) || 50, 200));
  const offset = Math.max(0, Number(query.offset) || 0);
  const startTs = `${startDate} 00:00:00`;
  const endTs = `${endDate} 23:59:59`;
  
  // Simple queries (no joins/subqueries)
  const [attributionEvents, clicks, attributionCount, clicksCount] = await Promise.all([
    AttributionChModel.queryAttributionEventsForTimeline(objectIds, startDate, endDate),
    AttributionChModel.queryClickEventsForTimeline(objectIds, startTs, endTs),
    AttributionChModel.queryAttributionEventsCountForTimeline(objectIds, startDate, endDate),
    AttributionChModel.queryClickEventsCountForTimeline(objectIds, startTs, endTs)
  ]);
  
  // Normalize clicks to same shape as attribution events
  const normalizedClicks = (clicks || []).map((click) => ({
    timestamp: click.timestamp,
    event_name: 'attributed_click',
    revenue: 0,
    plan_id: '',
    plan_name: '',
    channel: click.channel || '',
    source_name: click.source_name || '',
    device_id: '',
    user_id: ''
  }));
  
  // Merge and sort by timestamp (descending, recent first)
  const allEvents = [...(attributionEvents || []), ...normalizedClicks].sort((a, b) => {
    const tsA = new Date(a.timestamp).getTime();
    const tsB = new Date(b.timestamp).getTime();
    return tsB - tsA;
  });
  
  const total = (attributionCount || 0) + (clicksCount || 0);
  
  // Paginate
  const paginated = allEvents.slice(offset, offset + limit);
  
  return {
    events: paginated,
    total,
    limit,
    offset
  };
};

exports.listTrackingLinks = async function (pagination) {
  const limit = Math.min(Number(pagination.limit) || 50, 200);
  const offset = Number(pagination.offset) || 0;
  const filters = {};
  if (pagination.influencer_profile_id) {
    filters.influencer_profile_id = pagination.influencer_profile_id;
  }
  const rows = await TrackingLinkModel.list(limit, offset, filters);
  return { data: rows };
};

exports.createTrackingLink = async function (payload, adminUserId) {
  if (!payload.channel || typeof payload.channel !== 'string') {
    const err = new Error('channel is required');
    err.statusCode = 400;
    throw err;
  }
  const shortCode = await resolveShortCodeForCreate(payload);
  // Auto-fill source_name with short_code if not provided
  const sourceName = payload.source_name || shortCode;
  if (payload.influencer_profile_id) {
    const prof = await InfluencerModel.getById(payload.influencer_profile_id);
    if (!prof) {
      const err = new Error('influencer_profile_id not found');
      err.statusCode = 400;
      throw err;
    }
  }
  const id = uuidv4();
  await TrackingLinkModel.insert({
    id,
    short_code: shortCode,
    display_name: payload.display_name,
    channel: payload.channel,
    platform: payload.platform || 'all',
    placement_platform: payload.placement_platform || null,
    source_name: sourceName,
    campaign: payload.campaign,
    utm_medium: payload.utm_medium,
    ad_group: payload.ad_group,
    ad_name: payload.ad_name,
    deep_link_path: payload.deep_link_path,
    redirect_url: payload.redirect_url,
    tags: payload.tags,
    is_active: true,
    created_by: adminUserId ? String(adminUserId) : null,
    attribution_provider: normalizeProvider(payload.attribution_provider, 'internal'),
    external_link_key: payload.external_link_key,
    metadata: payload.metadata,
    schema_version: payload.schema_version != null ? Number(payload.schema_version) : 1,
    influencer_profile_id: payload.influencer_profile_id || null
  });
  return TrackingLinkModel.getById(id);
};

exports.updateTrackingLink = async function (id, patch) {
  const row = await TrackingLinkModel.getById(id);
  if (!row) {
    const err = new Error('Not found');
    err.statusCode = 404;
    throw err;
  }
  if (patch.influencer_profile_id !== undefined && patch.influencer_profile_id) {
    const prof = await InfluencerModel.getById(patch.influencer_profile_id);
    if (!prof) {
      const err = new Error('influencer_profile_id not found');
      err.statusCode = 400;
      throw err;
    }
  }
  if (patch.short_code !== undefined && patch.short_code !== null) {
    const raw = String(patch.short_code).trim();
    if (!raw) {
      const err = new Error('short_code cannot be empty');
      err.statusCode = 400;
      throw err;
    }
    if (!validateShortCode(raw)) {
      const err = new Error('Invalid short_code (2-50 chars, alphanumeric, hyphen, underscore)');
      err.statusCode = 400;
      throw err;
    }
    const normalized = raw.toLowerCase();
    const existing = await TrackingLinkModel.getByShortCode(normalized);
    if (existing && existing.id !== id) {
      const err = new Error('short_code already exists');
      err.statusCode = 409;
      throw err;
    }
    patch.short_code = normalized;
  }
  const next = { ...patch };
  if (next.attribution_provider !== undefined) {
    next.attribution_provider = normalizeProvider(next.attribution_provider || '', 'internal');
  }
  await TrackingLinkModel.update(id, next);
  await invalidateDeferredLinkCache(id);
  return TrackingLinkModel.getById(id);
};

exports.listInfluencers = async function (pagination) {
  const limit = Math.min(Number(pagination.limit) || 50, 200);
  const offset = Number(pagination.offset) || 0;
  const rows = await InfluencerModel.list(limit, offset);
  const data = rows.map((r) => serializeInfluencer(r));
  return { data };
};

exports.createInfluencer = async function (payload) {
  if (!payload.name || typeof payload.name !== 'string') {
    const err = new Error('name is required');
    err.statusCode = 400;
    throw err;
  }
  const id = uuidv4();
  const profileUrls = normalizeProfileUrls(payload.profile_urls);
  const platformForDb =
    platformStringFromPayload(payload.platforms ?? payload.platform) ??
    (profileUrls ? Object.keys(profileUrls).join(',') : null);
  await InfluencerModel.insert({
    id,
    name: payload.name,
    handle: payload.handle ?? null,
    platform: platformForDb,
    profile_urls: profileUrls,
    is_active: true,
    attribution_provider: normalizeProvider(payload.attribution_provider, 'internal'),
    external_profile_key: payload.external_profile_key,
    metadata: payload.metadata,
    schema_version: payload.schema_version != null ? Number(payload.schema_version) : 1
  });
  const row = await InfluencerModel.getById(id);
  return serializeInfluencer(row);
};

exports.updateInfluencer = async function (id, patch) {
  const row = await InfluencerModel.getById(id);
  if (!row) {
    const err = new Error('Not found');
    err.statusCode = 404;
    throw err;
  }
  const next = { ...patch };
  if (next.attribution_provider !== undefined) {
    next.attribution_provider = normalizeProvider(next.attribution_provider || '', 'internal');
  }
  if (patch.platforms !== undefined || patch.platform !== undefined) {
    next.platform = platformStringFromPayload(patch.platforms ?? patch.platform);
    delete next.platforms;
  }
  if (patch.profile_urls !== undefined) {
    const normalized = normalizeProfileUrls(patch.profile_urls);
    next.profile_urls = normalized;
    next.platform =
      platformStringFromPayload(patch.platforms ?? patch.platform) ??
      (normalized ? Object.keys(normalized).join(',') : null);
    delete next.platforms;
  }
  await InfluencerModel.update(id, next);
  const updated = await InfluencerModel.getById(id);
  return serializeInfluencer(updated);
};

exports.getOverview = async function (query) {
  const startDate = query.start_date || query.startDate;
  const endDate = query.end_date || query.endDate;
  if (!startDate || !endDate) {
    const err = new Error('start_date and end_date are required (YYYY-MM-DD)');
    err.statusCode = 400;
    throw err;
  }
  const deviceOs = normalizeDeviceOs(query);
  const useOsFilter = deviceOs === 'ios' || deviceOs === 'android';
  const osParam = useOsFilter ? deviceOs : null;
  const startTs = `${startDate} 00:00:00`;
  const endTs = `${endDate} 23:59:59`;
  const [byChannel, clicksByCode, clicksByChannel, installsByDay, installsByOs, signupsByAuthOccasion, funnelByOs, purchaseRepeatSummary] =
    await Promise.all([
      useOsFilter
        ? AttributionChModel.queryAttributionByChannelFromRaw(startDate, endDate, deviceOs)
        : AttributionChModel.queryAttributionByChannel(startDate, endDate),
      AttributionChModel.queryClicksByShortCode(startTs, endTs),
      AttributionChModel.queryClicksByChannel(startTs, endTs),
      AttributionChModel.queryInstallsByDay(startDate, endDate, osParam),
      AttributionChModel.queryInstallsByOs(startDate, endDate, osParam),
      AttributionChModel.querySignupsByAuthOccasion(startDate, endDate, osParam),
      AttributionChModel.queryFunnelMetricsByOs(startDate, endDate),
      AttributionChModel.queryPurchaseRepeatSummaryGlobal(startDate, endDate, osParam)
    ]);
  return {
    attribution_by_channel: byChannel,
    clicks_by_short_code: clicksByCode,
    clicks_by_channel: clicksByChannel,
    installs_by_day: installsByDay,
    installs_by_os: installsByOs,
    signups_by_auth_occasion: signupsByAuthOccasion,
    funnel_by_os: funnelByOs,
    device_os: deviceOs,
    purchase_repeat_summary: purchaseRepeatSummary
  };
};

exports.getLinkStats = async function (linkId, query) {
  const startDate = query.start_date || query.startDate;
  const endDate = query.end_date || query.endDate;
  if (!startDate || !endDate) {
    const err = new Error('start_date and end_date are required (YYYY-MM-DD)');
    err.statusCode = 400;
    throw err;
  }
  const link = await TrackingLinkModel.getById(linkId);
  if (!link) {
    const err = new Error('Not found');
    err.statusCode = 404;
    throw err;
  }
  const deviceOs = normalizeDeviceOs(query);
  const analytics = await buildAnalyticsForLinks([link.id], startDate, endDate, deviceOs);
  return { link, analytics };
};

/**
 * Profile detail + all links for this profile + combined ClickHouse analytics.
 */
exports.getProfileStats = async function (profileId, query) {
  const startDate = query.start_date || query.startDate;
  const endDate = query.end_date || query.endDate;
  if (!startDate || !endDate) {
    const err = new Error('start_date and end_date are required (YYYY-MM-DD)');
    err.statusCode = 400;
    throw err;
  }
  const profile = await InfluencerModel.getById(profileId);
  if (!profile) {
    const err = new Error('Not found');
    err.statusCode = 404;
    throw err;
  }
  const links = await TrackingLinkModel.listByInfluencerProfileId(profileId);
  const linkIds = links.map((l) => l.id);
  const deviceOs = normalizeDeviceOs(query);
  const analytics = await buildAnalyticsForLinks(linkIds, startDate, endDate, deviceOs);
  return { profile: serializeInfluencer(profile), links, analytics };
};

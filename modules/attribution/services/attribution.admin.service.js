'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const TrackingLinkModel = require('../models/tracking_link.model');
const { invalidateDeferredLinkCache } = require('./attribution.deferred.redis.service');
const InfluencerModel = require('../models/influencer_profile.model');
const AttributionChModel = require('../models/attribution_ch.model');
const { resolveAttributionDateWindow } = require('../utils/attribution_date_window.util');

const SHORT_CODE_RE = /^[a-z0-9][a-z0-9-_]{1,48}$/i;
const PROVIDER_RE = /^[a-z0-9][a-z0-9_.-]{0,48}$/i;

/** Allowlisted platform keys for profile_urls. Add new platforms here – no DB migration needed. */
const PROFILE_URL_PLATFORMS = new Set(['instagram', 'youtube', 'twitter', 'tiktok', 'linkedin', 'facebook']);
const URL_RE = /^https?:\/\/[^\s]+$/i;

function normalizeSlOpenMode(val) {
  return val === 'instant_redirect' ? 'instant_redirect' : 'landing_page';
}

function normalizeSlLanding(val) {
  return val === 'website_only' ? 'website_only' : 'app_install';
}

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

/** Derive os_family (ios/android/other) from install_os and os_name. */
function deriveOsFamily(installOs, osName) {
  const i = String(installOs || '').toLowerCase();
  const n = String(osName || '').toLowerCase();
  if (i === 'ios' || i === 'android') return i;
  if (n.includes('ios') || n.includes('iphone')) return 'ios';
  if (n.includes('android')) return 'android';
  return 'other';
}

/** Stitch funnel rows: group by derived os_family, event_name. */
function stitchFunnelByOs(rows) {
  if (!rows || !rows.length) return [];
  const byOs = {};
  for (const r of rows) {
    const osKey = deriveOsFamily(r.install_os, r.os_name);
    if (!byOs[osKey]) {
      byOs[osKey] = { os_family: osKey, events: {} };
    }
    const ev = r.event_name;
    if (!byOs[osKey].events[ev]) {
      byOs[osKey].events[ev] = { cnt: 0, total_revenue: 0 };
    }
    byOs[osKey].events[ev].cnt += Number(r.cnt) || 0;
    byOs[osKey].events[ev].total_revenue += Number(r.total_revenue) || 0;
  }
  const out = [];
  for (const [osKey, data] of Object.entries(byOs)) {
    for (const [ev, vals] of Object.entries(data.events)) {
      out.push({ os_family: osKey, event_name: ev, cnt: vals.cnt, total_revenue: vals.total_revenue });
    }
  }
  return out.sort((a, b) => a.os_family.localeCompare(b.os_family) || a.event_name.localeCompare(b.event_name));
}

/** Stitch installs by OS: group by derived os_family. */
function stitchInstallsByOs(rows) {
  if (!rows || !rows.length) return [];
  const byOs = {};
  for (const r of rows) {
    const osKey = deriveOsFamily(r.install_os, r.os_name);
    byOs[osKey] = (byOs[osKey] || 0) + (Number(r.installs) || 0);
  }
  return Object.entries(byOs).map(([os_family, installs]) => ({ os_family, installs }))
    .sort((a, b) => b.installs - a.installs);
}

/** Map empty auth_occasion to 'unknown' and merge duplicates. */
function stitchSignupsByAuthOccasion(rows) {
  if (!rows || !rows.length) return [];
  const byKey = {};
  for (const r of rows) {
    const key = (r.auth_occasion && String(r.auth_occasion).trim()) ? String(r.auth_occasion) : 'unknown';
    byKey[key] = (byKey[key] || 0) + (Number(r.signups) || 0);
  }
  return Object.entries(byKey).map(([auth_occasion, signups]) => ({ auth_occasion, signups }))
    .sort((a, b) => b.signups - a.signups);
}

/** Stitch purchase repeat summary from byUser and byOrdinal. */
function stitchPurchaseRepeatSummary(byUser, byOrdinal) {
  const repeatBuyers = (byUser || []).filter((r) => Number(r.cnt) >= 2).length;
  let total = 0;
  let taggedFirst = 0;
  let taggedRepeat = 0;
  for (const r of byOrdinal || []) {
    const n = Number(r.cnt) || 0;
    const ord = parseInt(r.purchase_ordinal, 10) || 0;
    total += n;
    if (ord === 1) taggedFirst += n;
    else if (ord >= 2) taggedRepeat += n;
  }
  return {
    repeat_buyers_distinct_users: repeatBuyers,
    purchase_events_total: total,
    purchase_events_tagged_first: taggedFirst,
    purchase_events_tagged_repeat: taggedRepeat
  };
}

const CHANNEL_GROUP_LEGACY_LABEL = 'Unassigned (legacy)';

/** Map empty / null CH channel_group to display label (normalization done in app, not SQL). */
function normalizeChannelGroupKey(raw) {
  const s = raw != null ? String(raw).trim() : '';
  return s || CHANNEL_GROUP_LEGACY_LABEL;
}

function isClassifiedChannelGroup(key) {
  return key && key !== CHANNEL_GROUP_LEGACY_LABEL;
}

function emptyChannelGroupRow(channelGroup) {
  return {
    channel_group: channelGroup,
    link_clicks: 0,
    app_opens: 0,
    installs: 0,
    signups: 0,
    add_to_cart: 0,
    purchases: 0,
    revenue: 0
  };
}

/** Aggregate attribution events + click rollups into MMP-style channel_group buckets. */
function stitchChannelGroupMetrics(eventRows, clickRows) {
  const byGroup = {};
  const ensure = (rawGroup) => {
    const g = normalizeChannelGroupKey(rawGroup);
    if (!byGroup[g]) byGroup[g] = emptyChannelGroupRow(g);
    return byGroup[g];
  };

  for (const r of clickRows || []) {
    const row = ensure(r.channel_group);
    row.link_clicks += Number(r.clicks) || 0;
  }

  for (const r of eventRows || []) {
    const row = ensure(r.channel_group);
    const ev = r.event_name;
    const cnt = Number(r.total_events) || 0;
    const rev = Number(r.total_revenue) || 0;
    if (ev === 'app_open') row.app_opens += cnt;
    else if (ev === 'attributed_install') row.installs += cnt;
    else if (ev === 'attributed_signup') row.signups += cnt;
    else if (ev === 'attributed_add_to_cart') row.add_to_cart += cnt;
    else if (ev === 'attributed_purchase') {
      row.purchases += cnt;
      row.revenue += rev;
    }
  }

  return Object.values(byGroup).sort(
    (a, b) => b.installs - a.installs || b.link_clicks - a.link_clicks || a.channel_group.localeCompare(b.channel_group)
  );
}

async function queryChannelGroupEventRows(window, deviceOs) {
  const os = deviceOs === 'ios' || deviceOs === 'android' ? deviceOs : null;
  return AttributionChModel.queryAttributionByChannelGroupFromRaw(window, os);
}

async function queryChannelGroupClickRows(window) {
  return AttributionChModel.queryClicksByChannelGroupFromRaw(window);
}

function attributionRangeMeta(window) {
  return {
    timezone: window.tz,
    start_date: window.startCal,
    end_date: window.endCal
  };
}

function breakdownRowKey(r) {
  return [
    r.media_source || '',
    r.medium || '',
    r.classification_reason || '',
    r.legacy_channel || '',
    r.attribution_method || '',
    r.utm_source || '',
    r.utm_campaign || ''
  ].join('\0');
}

function emptyBreakdownRow(seed = {}) {
  return {
    media_source: seed.media_source || '',
    medium: seed.medium || '',
    classification_reason: seed.classification_reason || '',
    legacy_channel: seed.legacy_channel || '',
    attribution_method: seed.attribution_method || '',
    utm_source: seed.utm_source || '',
    utm_campaign: seed.utm_campaign || '',
    link_clicks: 0,
    app_opens: 0,
    installs: 0,
    signups: 0,
    add_to_cart: 0,
    purchases: 0,
    revenue: 0
  };
}

/** Stitch per-dimension event rows into funnel breakdown lines. */
function stitchChannelGroupBreakdown(eventRows, clickRows) {
  const byKey = {};

  for (const r of clickRows || []) {
    const seed = {
      media_source: r.media_source,
      medium: r.medium,
      classification_reason: r.classification_reason,
      legacy_channel: '',
      attribution_method: '',
      utm_source: '',
      utm_campaign: r.campaign || ''
    };
    const k = breakdownRowKey(seed);
    if (!byKey[k]) byKey[k] = emptyBreakdownRow(seed);
    byKey[k].link_clicks += Number(r.clicks) || 0;
  }

  for (const r of eventRows || []) {
    const seed = {
      media_source: r.media_source,
      medium: r.medium,
      classification_reason: r.classification_reason,
      legacy_channel: r.legacy_channel,
      attribution_method: r.attribution_method,
      utm_source: r.utm_source,
      utm_campaign: r.utm_campaign
    };
    const k = breakdownRowKey(seed);
    if (!byKey[k]) byKey[k] = emptyBreakdownRow(seed);
    const row = byKey[k];
    const cnt = Number(r.total_events) || 0;
    const rev = Number(r.total_revenue) || 0;
    const ev = r.event_name;
    if (ev === 'app_open') row.app_opens += cnt;
    else if (ev === 'attributed_install') row.installs += cnt;
    else if (ev === 'attributed_signup') row.signups += cnt;
    else if (ev === 'attributed_add_to_cart') row.add_to_cart += cnt;
    else if (ev === 'attributed_purchase') {
      row.purchases += cnt;
      row.revenue += rev;
    }
  }

  return Object.values(byKey).sort(
    (a, b) => b.installs - a.installs || b.link_clicks - a.link_clicks || b.signups - a.signups
  );
}

function stitchFunnelFromEventCountRows(rows) {
  const totals = emptyChannelGroupRow('');
  delete totals.channel_group;
  for (const r of rows || []) {
    const cnt = Number(r.cnt) || 0;
    const rev = Number(r.revenue) || 0;
    const ev = r.event_name;
    if (ev === 'app_open') totals.app_opens += cnt;
    else if (ev === 'attributed_install') totals.installs += cnt;
    else if (ev === 'attributed_signup') totals.signups += cnt;
    else if (ev === 'attributed_add_to_cart') totals.add_to_cart += cnt;
    else if (ev === 'attributed_purchase') {
      totals.purchases += cnt;
      totals.revenue += rev;
    }
  }
  return totals;
}

async function buildChannelGroupDetail(window, channelGroup, deviceOs, objectIds, linkIds) {
  const osParam = deviceOs === 'ios' || deviceOs === 'android' ? deviceOs : null;
  const [eventRows, clickRows, funnelRows] = await Promise.all([
    AttributionChModel.queryChannelGroupEventBreakdownFromRaw(window, channelGroup, osParam, objectIds),
    AttributionChModel.queryChannelGroupClickBreakdownFromRaw(window, channelGroup, linkIds),
    AttributionChModel.queryChannelGroupFunnelFromRaw(window, channelGroup, osParam, objectIds)
  ]);
  const breakdown = stitchChannelGroupBreakdown(eventRows, clickRows);
  const funnelTotals = stitchFunnelFromEventCountRows(funnelRows);
  funnelTotals.link_clicks = breakdown.reduce((s, r) => s + (Number(r.link_clicks) || 0), 0);
  return {
    channel_group: normalizeChannelGroupKey(channelGroup),
    totals: funnelTotals,
    breakdown,
    ...attributionRangeMeta(window)
  };
}

async function buildChannelGroupOverview(window, deviceOs) {
  const [eventRows, clickRows] = await Promise.all([
    queryChannelGroupEventRows(window, deviceOs),
    queryChannelGroupClickRows(window)
  ]);
  const byChannelGroup = stitchChannelGroupMetrics(eventRows, clickRows);
  let classifiedEvents = 0;
  let totalEvents = 0;
  for (const r of eventRows || []) {
    const cnt = Number(r.total_events) || 0;
    totalEvents += cnt;
    if (isClassifiedChannelGroup(normalizeChannelGroupKey(r.channel_group))) classifiedEvents += cnt;
  }
  return {
    by_channel_group: byChannelGroup,
    device_os: deviceOs || 'all',
    coverage: {
      total_events: totalEvents,
      classified_events: classifiedEvents,
      unclassified_events: Math.max(0, totalEvents - classifiedEvents)
    },
    classification_version: 1,
    ...attributionRangeMeta(window)
  };
}

/**
 * ClickHouse analytics for one or more tracking link ids (object_id in raw events).
 * Installs chart is install-only; attribution_events includes all types (e.g. attributed_purchase + revenue);
 * purchases_by_day is ready when the app sends authenticated attributed_purchase events.
 */
async function buildAnalyticsForLinks(linkIds, window, osFilter) {
  const os = osFilter === 'ios' || osFilter === 'android' ? osFilter : null;
  if (!linkIds || !linkIds.length) {
    return {
      clicks_total: 0,
      attribution_events: [],
      installs_by_day: [],
      app_opens_by_day: [],
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
      },
      ...attributionRangeMeta(window)
    };
  }
  const [
    clicks,
    events,
    installsByDay,
    appOpensByDay,
    purchasesByDay,
    eventsByPlan,
    signupsRaw,
    funnelRaw,
    installsByOsRaw,
    attributionByChannel,
    clicksByChannel,
    byUser,
    byOrdinal
  ] = await Promise.all([
    AttributionChModel.queryClickCountForLinkIds(linkIds, window),
    AttributionChModel.queryAttributionEventsForObjectIds(linkIds, window, os),
    AttributionChModel.queryInstallsByDayForObjectIds(linkIds, window, os),
    AttributionChModel.queryAppOpensByDayForObjectIds(linkIds, window, os),
    AttributionChModel.queryPurchasesByDayForObjectIds(linkIds, window, os),
    AttributionChModel.queryAttributionEventsByPlanForObjectIds(linkIds, window, os),
    AttributionChModel.querySignupsByAuthOccasionForObjectIds(linkIds, window, os),
    AttributionChModel.queryFunnelMetricsByOsForObjectIds(linkIds, window),
    AttributionChModel.queryInstallsByOsForObjectIds(linkIds, window, os),
    AttributionChModel.queryAttributionByChannelFromRawForObjectIds(linkIds, window, os),
    AttributionChModel.queryClicksByChannelForLinkIds(linkIds, window),
    AttributionChModel.queryPurchaseCountsByUser(linkIds, window, os),
    AttributionChModel.queryPurchasesByOrdinal(linkIds, window, os)
  ]);
  return {
    clicks_total: clicks.total,
    attribution_events: events,
    installs_by_day: installsByDay,
    app_opens_by_day: appOpensByDay,
    purchases_by_day: purchasesByDay,
    events_by_plan: eventsByPlan,
    signups_by_auth_occasion: stitchSignupsByAuthOccasion(signupsRaw),
    device_os: os || 'all',
    funnel_by_os: stitchFunnelByOs(funnelRaw),
    installs_by_os: stitchInstallsByOs(installsByOsRaw),
    attribution_by_channel: attributionByChannel,
    clicks_by_channel: clicksByChannel,
    purchase_repeat_summary: stitchPurchaseRepeatSummary(byUser, byOrdinal),
    ...attributionRangeMeta(window)
  };
}

/**
 * Get paginated timeline of individual attribution events for link(s) or profile.
 * Stitches clicks and attribution events in service layer (no joins/subqueries in model).
 */
exports.getAttributionEventsTimeline = async function (objectIds, query) {
  const window = resolveAttributionDateWindow(query);
  if (!objectIds || !Array.isArray(objectIds) || !objectIds.length) {
    return { events: [], total: 0, limit: 50, offset: 0, ...attributionRangeMeta(window) };
  }
  const limit = Math.max(1, Math.min(Number(query.limit) || 50, 200));
  const offset = Math.max(0, Number(query.offset) || 0);

  const [attributionEvents, clicks, attributionCount, clicksCount] = await Promise.all([
    AttributionChModel.queryAttributionEventsForTimeline(objectIds, window),
    AttributionChModel.queryClickEventsForTimeline(objectIds, window),
    AttributionChModel.queryAttributionEventsCountForTimeline(objectIds, window),
    AttributionChModel.queryClickEventsCountForTimeline(objectIds, window)
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
    offset,
    ...attributionRangeMeta(window)
  };
};

exports.listTrackingLinks = async function (pagination) {
  const limit = Math.min(Number(pagination.limit) || 50, 200);
  const offset = Number(pagination.offset) || 0;
  const filters = {};
  if (pagination.influencer_profile_id) {
    filters.influencer_profile_id = pagination.influencer_profile_id;
  }
  if (pagination.photo_booth_id) {
    filters.photo_booth_id = pagination.photo_booth_id;
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
  const slLanding = normalizeSlLanding(payload.sl_landing);
  const slOpenMode = normalizeSlOpenMode(payload.sl_open_mode);
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
    influencer_profile_id: payload.influencer_profile_id || null,
    photo_booth_id: payload.photo_booth_id || null,
    sl_landing: slLanding,
    sl_open_mode: slOpenMode
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
  if (patch.sl_landing !== undefined) {
    patch.sl_landing = normalizeSlLanding(patch.sl_landing);
  }
  if (patch.sl_open_mode !== undefined) {
    patch.sl_open_mode = normalizeSlOpenMode(patch.sl_open_mode);
  }
  const next = { ...patch };
  if (next.attribution_provider !== undefined) {
    next.attribution_provider = normalizeProvider(next.attribution_provider || '', 'internal');
  }
  await TrackingLinkModel.update(id, next);
  await invalidateDeferredLinkCache(id);
  return TrackingLinkModel.getById(id);
};

function emptyAttributionFunnelMetrics() {
  return { link_clicks: 0, app_opens: 0, installs: 0, signups: 0, add_to_cart: 0, purchases: 0 };
}

function stitchLinkClickCounts(rows, targetMap, keyForRow) {
  for (const row of rows) {
    const key = keyForRow(row);
    if (!key || !targetMap[key]) continue;
    targetMap[key].link_clicks += Number(row.clicks) || 0;
  }
}

function stitchAttributionEventCounts(rows, targetMap, keyForRow) {
  for (const row of rows) {
    const key = keyForRow(row);
    if (!key || !targetMap[key]) continue;
    const n = Number(row.cnt) || 0;
    const ev = row.event_name;
    if (ev === 'app_open') targetMap[key].app_opens += n;
    else if (ev === 'attributed_install') targetMap[key].installs += n;
    else if (ev === 'attributed_signup') targetMap[key].signups += n;
    else if (ev === 'attributed_add_to_cart') targetMap[key].add_to_cart += n;
    else if (ev === 'attributed_purchase') targetMap[key].purchases += n;
  }
}

async function queryAttributionFunnelCountsForLinks(linkIds, window, deviceOs) {
  if (!linkIds.length) return [];
  const os = deviceOs === 'ios' || deviceOs === 'android' ? deviceOs : null;
  return AttributionChModel.queryAttributionEventCountsByObjectIds(linkIds, window, os);
}

async function buildLinkListMetrics(linkIds, window, deviceOs) {
  const byLink = Object.fromEntries(linkIds.map((id) => [id, emptyAttributionFunnelMetrics()]));
  if (!linkIds.length) return byLink;
  const [eventRows, clickRows] = await Promise.all([
    queryAttributionFunnelCountsForLinks(linkIds, window, deviceOs),
    AttributionChModel.queryClickCountsByLinkIds(linkIds, window)
  ]);
  stitchAttributionEventCounts(eventRows, byLink, (row) => row.object_id);
  stitchLinkClickCounts(clickRows, byLink, (row) => row.link_id);
  return byLink;
}

async function buildProfileListMetrics(profileIds, window, deviceOs) {
  if (!profileIds.length) return {};
  const byProfile = Object.fromEntries(profileIds.map((id) => [id, emptyAttributionFunnelMetrics()]));
  const links = await TrackingLinkModel.listByInfluencerProfileIds(profileIds);
  if (!links.length) return byProfile;
  const linkToProfile = new Map(links.map((l) => [l.id, l.influencer_profile_id]));
  const linkIds = links.map((l) => l.id);
  const [eventRows, clickRows] = await Promise.all([
    queryAttributionFunnelCountsForLinks(linkIds, window, deviceOs),
    AttributionChModel.queryClickCountsByLinkIds(linkIds, window)
  ]);
  stitchAttributionEventCounts(eventRows, byProfile, (row) => linkToProfile.get(row.object_id));
  stitchLinkClickCounts(clickRows, byProfile, (row) => linkToProfile.get(row.link_id));
  return byProfile;
}

exports.listInfluencers = async function (pagination) {
  const limit = Math.min(Number(pagination.limit) || 50, 200);
  const offset = Number(pagination.offset) || 0;
  const rows = await InfluencerModel.list(limit, offset, {
    list_in_admin_only: !!pagination.admin_list_only
  });
  let data = rows.map((r) => serializeInfluencer(r));
  const startDate = pagination.start_date || pagination.startDate;
  const endDate = pagination.end_date || pagination.endDate;
  if (startDate && endDate) {
    const window = resolveAttributionDateWindow(pagination);
    const deviceOs = normalizeDeviceOs(pagination);
    const metricsByProfile = await buildProfileListMetrics(
      data.map((r) => r.id),
      window,
      deviceOs
    );
    data = data.map((r) => ({
      ...r,
      metrics: metricsByProfile[r.id] || emptyAttributionFunnelMetrics()
    }));
  }
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
    list_in_admin: payload.list_in_admin === false ? false : true,
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

exports.getOverviewChannelGroups = async function (query) {
  const window = resolveAttributionDateWindow(query);
  const deviceOs = normalizeDeviceOs(query);
  return buildChannelGroupOverview(window, deviceOs);
};

exports.getOverviewChannelGroupDetail = async function (query) {
  const window = resolveAttributionDateWindow(query);
  const channelGroup = query.channel_group || query.channelGroup;
  if (!channelGroup) {
    const err = new Error('channel_group is required');
    err.statusCode = 400;
    throw err;
  }
  const deviceOs = normalizeDeviceOs(query);
  return buildChannelGroupDetail(window, channelGroup, deviceOs, null, null);
};

exports.getProfileChannelGroupDetail = async function (profileId, query) {
  const window = resolveAttributionDateWindow(query);
  const channelGroup = query.channel_group || query.channelGroup;
  if (!channelGroup) {
    const err = new Error('channel_group is required');
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
  return {
    profile: serializeInfluencer(profile),
    ...(await buildChannelGroupDetail(window, channelGroup, deviceOs, linkIds, linkIds))
  };
};

exports.getLinkChannelGroupDetail = async function (linkId, query) {
  const window = resolveAttributionDateWindow(query);
  const channelGroup = query.channel_group || query.channelGroup;
  if (!channelGroup) {
    const err = new Error('channel_group is required');
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
  return {
    link,
    ...(await buildChannelGroupDetail(window, channelGroup, deviceOs, [link.id], [link.id]))
  };
};

exports.getProfileChannelGroups = async function (profileId, query) {
  const window = resolveAttributionDateWindow(query);
  const profile = await InfluencerModel.getById(profileId);
  if (!profile) {
    const err = new Error('Not found');
    err.statusCode = 404;
    throw err;
  }
  const links = await TrackingLinkModel.listByInfluencerProfileId(profileId);
  const linkIds = links.map((l) => l.id);
  const deviceOs = normalizeDeviceOs(query);
  const osParam = deviceOs === 'ios' || deviceOs === 'android' ? deviceOs : null;
  const [eventRows, clickRows] = await Promise.all([
    AttributionChModel.queryAttributionByChannelGroupForObjectIds(linkIds, window, osParam),
    AttributionChModel.queryClicksByChannelGroupForLinkIds(linkIds, window)
  ]);
  return {
    profile: serializeInfluencer(profile),
    by_channel_group: stitchChannelGroupMetrics(eventRows, clickRows),
    device_os: deviceOs,
    ...attributionRangeMeta(window)
  };
};

exports.getLinkChannelGroups = async function (linkId, query) {
  const window = resolveAttributionDateWindow(query);
  const link = await TrackingLinkModel.getById(linkId);
  if (!link) {
    const err = new Error('Not found');
    err.statusCode = 404;
    throw err;
  }
  const deviceOs = normalizeDeviceOs(query);
  const osParam = deviceOs === 'ios' || deviceOs === 'android' ? deviceOs : null;
  const [eventRows, clickRows] = await Promise.all([
    AttributionChModel.queryAttributionByChannelGroupForObjectIds([link.id], window, osParam),
    AttributionChModel.queryClicksByChannelGroupForLinkIds([link.id], window)
  ]);
  return {
    link,
    by_channel_group: stitchChannelGroupMetrics(eventRows, clickRows),
    device_os: deviceOs,
    ...attributionRangeMeta(window)
  };
};

exports.getClassificationDiag = async function (query) {
  const window = resolveAttributionDateWindow(query);
  const [totals, distribution] = await Promise.all([
    AttributionChModel.queryClassificationEventTotalsFromRaw(window),
    AttributionChModel.queryClassificationDistributionFromRaw(window)
  ]);
  const totalEvents = Number(totals.total_events) || 0;
  const classifiedEvents = Number(totals.classified_events) || 0;
  return {
    total_events: totalEvents,
    classified_events: classifiedEvents,
    unclassified_events: Math.max(0, totalEvents - classifiedEvents),
    distribution: distribution || [],
    ...attributionRangeMeta(window)
  };
};

exports.getOverview = async function (query) {
  const window = resolveAttributionDateWindow(query);
  const deviceOs = normalizeDeviceOs(query);
  const osParam = deviceOs === 'ios' || deviceOs === 'android' ? deviceOs : null;
  const [
    byChannel,
    clicksByCode,
    clicksByChannel,
    installsByDay,
    appOpensByDay,
    installsByOsRaw,
    signupsRaw,
    funnelRaw,
    byUser,
    byOrdinal
  ] = await Promise.all([
    AttributionChModel.queryAttributionByChannelFromRaw(window, osParam),
    AttributionChModel.queryClicksByShortCode(window),
    AttributionChModel.queryClicksByChannel(window),
    AttributionChModel.queryInstallsByDay(window, osParam),
    AttributionChModel.queryAppOpensByDay(window, osParam),
    AttributionChModel.queryInstallsByOs(window, osParam),
    AttributionChModel.querySignupsByAuthOccasion(window, osParam),
    AttributionChModel.queryFunnelMetricsByOs(window),
    AttributionChModel.queryPurchaseCountsByUser(null, window, osParam),
    AttributionChModel.queryPurchasesByOrdinal(null, window, osParam)
  ]);
  return {
    attribution_by_channel: byChannel,
    clicks_by_short_code: clicksByCode,
    clicks_by_channel: clicksByChannel,
    installs_by_day: installsByDay,
    app_opens_by_day: appOpensByDay,
    installs_by_os: stitchInstallsByOs(installsByOsRaw),
    signups_by_auth_occasion: stitchSignupsByAuthOccasion(signupsRaw),
    funnel_by_os: stitchFunnelByOs(funnelRaw),
    device_os: deviceOs,
    purchase_repeat_summary: stitchPurchaseRepeatSummary(byUser, byOrdinal),
    ...attributionRangeMeta(window)
  };
};

exports.getLinkStats = async function (linkId, query) {
  const window = resolveAttributionDateWindow(query);
  const link = await TrackingLinkModel.getById(linkId);
  if (!link) {
    const err = new Error('Not found');
    err.statusCode = 404;
    throw err;
  }
  const deviceOs = normalizeDeviceOs(query);
  const analytics = await buildAnalyticsForLinks([link.id], window, deviceOs);
  return { link, analytics };
};

/**
 * Profile detail + all links for this profile + combined ClickHouse analytics.
 */
exports.getProfileStats = async function (profileId, query) {
  const window = resolveAttributionDateWindow(query);
  const profile = await InfluencerModel.getById(profileId);
  if (!profile) {
    const err = new Error('Not found');
    err.statusCode = 404;
    throw err;
  }
  const links = await TrackingLinkModel.listByInfluencerProfileId(profileId);
  const linkIds = links.map((l) => l.id);
  const deviceOs = normalizeDeviceOs(query);
  const [analytics, metricsByLink] = await Promise.all([
    buildAnalyticsForLinks(linkIds, window, deviceOs),
    buildLinkListMetrics(linkIds, window, deviceOs)
  ]);
  const linksWithMetrics = links.map((l) => ({
    ...l,
    metrics: metricsByLink[l.id] || emptyAttributionFunnelMetrics()
  }));
  return { profile: serializeInfluencer(profile), links: linksWithMetrics, analytics };
};

const MAGIC_PHOTOBOOTH_PROFILE_KEY = 'tellow_magic_photobooth';
const MAGIC_PHOTOBOOTH_PROFILE_NAME = 'Tellow Magic Photobooth';

/**
 * System acquisition profile for admin-created magic photobooth share links.
 */
exports.ensureMagicPhotoboothProfile = async function () {
  let row = await InfluencerModel.getByExternalProfileKey(MAGIC_PHOTOBOOTH_PROFILE_KEY);
  if (row) return row;
  const id = uuidv4();
  await InfluencerModel.insert({
    id,
    name: MAGIC_PHOTOBOOTH_PROFILE_NAME,
    handle: 'tellow_magic_photobooth',
    platform: null,
    profile_urls: null,
    is_active: true,
    list_in_admin: true,
    attribution_provider: 'internal',
    external_profile_key: MAGIC_PHOTOBOOTH_PROFILE_KEY,
    metadata: { kind: 'photobooth_admin_bucket' },
    schema_version: 1
  });
  return InfluencerModel.getById(id);
};

/**
 * New tracking link under Tellow Magic Photobooth profile; deep link opens this booth in app / web funnel.
 * opts.sl_landing: 'app_install' | 'website_only' — controls public /sl page behavior.
 */
exports.createPhotoboothAdminShareLink = async function ({ photo_booth_id, booth_code, booth_name }, adminUserId, opts = {}) {
  if (!photo_booth_id || !booth_code) {
    const err = new Error('photo_booth_id and booth_code are required');
    err.statusCode = 400;
    throw err;
  }
  const slLanding = normalizeSlLanding(opts.sl_landing);
  const slOpenMode = normalizeSlOpenMode(opts.sl_open_mode);
  const profile = await exports.ensureMagicPhotoboothProfile();
  const shortCode = await resolveShortCodeForCreate({});
  const codeEnc = encodeURIComponent(String(booth_code).trim());
  const safeName = String(booth_name || 'Magic booth').trim() || 'Magic booth';
  const id = uuidv4();
  const campaignSlug = String(booth_code).replace(/[^a-zA-Z0-9_]+/g, '_');
  await TrackingLinkModel.insert({
    id,
    short_code: shortCode,
    display_name: `${safeName} (${booth_code})`,
    channel: 'offline',
    platform: 'all',
    placement_platform: null,
    source_name: shortCode,
    campaign: `photobooth_${campaignSlug}`,
    utm_medium: 'offline',
    ad_group: booth_code,
    ad_name: `pb_${campaignSlug}`,
    deep_link_path: `/photo-booth/${codeEnc}`,
    redirect_url: null,
    tags: ['photobooth', 'admin_magic_booth', 'generated_share'],
    is_active: true,
    created_by: adminUserId ? String(adminUserId) : null,
    attribution_provider: 'internal',
    external_link_key: null,
    metadata: {
      photo_booth_id,
      booth_code: String(booth_code).trim(),
      origin: 'admin_photobooth_detail',
      sl_landing: slLanding,
      sl_open_mode: slOpenMode
    },
    schema_version: 1,
    influencer_profile_id: profile.id,
    photo_booth_id,
    sl_landing: slLanding,
    sl_open_mode: slOpenMode
  });
  return TrackingLinkModel.getById(id);
};

exports.getLatestPhotoboothShareLink = async function (photoBoothId) {
  return TrackingLinkModel.getLatestByPhotoBoothId(photoBoothId);
};

function parseTrackingLinkMetadata(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw);
      return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Update share-link settings on the latest active booth link (same short URL, new behavior on /sl).
 */
exports.updatePhotoboothShareLinkSettings = async function (photoBoothId, settings = {}) {
  const link = await TrackingLinkModel.getLatestByPhotoBoothId(photoBoothId);
  if (!link) {
    const err = new Error('Share link not found');
    err.statusCode = 404;
    throw err;
  }
  const patch = {};
  const meta = parseTrackingLinkMetadata(link.metadata);
  if (settings.sl_landing !== undefined && settings.sl_landing !== null) {
    patch.sl_landing = normalizeSlLanding(settings.sl_landing);
    meta.sl_landing = patch.sl_landing;
  }
  if (settings.sl_open_mode !== undefined && settings.sl_open_mode !== null) {
    patch.sl_open_mode = normalizeSlOpenMode(settings.sl_open_mode);
    meta.sl_open_mode = patch.sl_open_mode;
  }
  if (!Object.keys(patch).length) {
    const err = new Error('sl_landing or sl_open_mode is required');
    err.statusCode = 400;
    throw err;
  }
  patch.metadata = meta;
  await TrackingLinkModel.update(link.id, patch);
  return TrackingLinkModel.getById(link.id);
};

/** @deprecated use updatePhotoboothShareLinkSettings */
exports.updatePhotoboothShareLinkSlLanding = async function (photoBoothId, slLandingRaw) {
  return exports.updatePhotoboothShareLinkSettings(photoBoothId, { sl_landing: slLandingRaw });
};

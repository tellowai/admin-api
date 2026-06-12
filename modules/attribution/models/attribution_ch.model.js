'use strict';

const { slaveClickhouse } = require('../../../config/lib/clickhouse');

function esc(str) {
  return String(str).replace(/'/g, "''");
}

/** Inclusive UTC bounds for analytics_events_raw.timestamp (DateTime64 UTC). */
function utcTimestampPrewhere(window) {
  const startEsc = esc(window.rangeStartUtc);
  const endEsc = esc(window.rangeEndUtc);
  return `timestamp >= toDateTime64('${startEsc}', 3, 'UTC') AND timestamp <= toDateTime64('${endEsc}', 3, 'UTC')`;
}

/** Same UTC window for link_clicks.timestamp. */
function linkClickTimestampPrewhere(window) {
  return utcTimestampPrewhere(window);
}

/** Calendar day in client TZ for daily series (matches Growth metrics). */
function clientDayExpr(tz) {
  const tzEsc = esc(String(tz || 'UTC').trim() || 'UTC');
  return `toString(toDate(toTimeZone(timestamp, '${tzEsc}')))`;
}

/** Simple object_ids filter. */
function objectIdsClause(objectIds) {
  if (!objectIds || !objectIds.length) return null;
  return objectIds.map((id) => `'${esc(String(id))}'`).join(',');
}

/** When device_os is ios|android, simple filter on install_os or os_name. */
function osFilterClause(osFilter) {
  if (!osFilter || String(osFilter).toLowerCase() === 'all') return '';
  const o = String(osFilter).toLowerCase();
  if (o === 'ios') {
    return " AND (lower(ifNull(properties['install_os'], '')) = 'ios' OR lower(ifNull(os_name, '')) LIKE '%ios%' OR lower(ifNull(os_name, '')) LIKE '%iphone%') ";
  }
  if (o === 'android') {
    return " AND (lower(ifNull(properties['install_os'], '')) = 'android' OR lower(ifNull(os_name, '')) LIKE '%android%') ";
  }
  return '';
}

/**
 * Aggregated attribution events from daily stats MV.
 */
exports.queryAttributionByChannel = async function (window) {
  const q = `
    SELECT
      event_name,
      ifNull(properties['channel'], '') AS channel,
      ifNull(properties['source_name'], '') AS source_name,
      count() AS total_events,
      sum(revenue) AS total_revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND ${utcTimestampPrewhere(window)}
    GROUP BY event_name, channel, source_name
    ORDER BY total_events DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Clicks per short_code in time range.
 */
exports.queryClicksByShortCode = async function (window) {
  const q = `
    SELECT
      short_code,
      count() AS clicks
    FROM link_clicks
    WHERE ${linkClickTimestampPrewhere(window)}
    GROUP BY short_code
    ORDER BY clicks DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Clicks per channel in time range (from link_clicks.channel). Used for Performance by channel.
 */
exports.queryClicksByChannel = async function (window) {
  const q = `
    SELECT
      ifNull(channel, '') AS channel,
      count() AS clicks
    FROM link_clicks
    WHERE ${linkClickTimestampPrewhere(window)}
    GROUP BY channel
    ORDER BY clicks DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Daily app opens for overview chart (platform-wide).
 */
exports.queryAppOpensByDay = async function (window, osFilter) {
  const os = osFilterClause(osFilter);
  const dayExpr = clientDayExpr(window.tz);
  const q = `
    SELECT ${dayExpr} AS day, ifNull(properties['channel'], '') AS channel, count() AS app_opens
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND event_name = 'app_open' AND ${utcTimestampPrewhere(window)} ${os}
    GROUP BY day, channel
    ORDER BY day ASC, channel ASC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Daily install events for chart.
 */
exports.queryInstallsByDay = async function (window, osFilter) {
  const os = osFilterClause(osFilter);
  const dayExpr = clientDayExpr(window.tz);
  const q = `
    SELECT ${dayExpr} AS day, ifNull(properties['channel'], '') AS channel, count() AS installs
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND event_name = 'attributed_install' AND ${utcTimestampPrewhere(window)} ${os}
    GROUP BY day, channel
    ORDER BY day ASC, channel ASC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Installs in range. Returns os_name and install_os for service to derive os_family.
 */
exports.queryInstallsByOs = async function (window, osFilter) {
  const os = osFilterClause(osFilter);
  const q = `
    SELECT
      ifNull(os_name, '') AS os_name,
      ifNull(properties['install_os'], '') AS install_os,
      count() AS installs
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_install'
      AND ${utcTimestampPrewhere(window)}
      ${os}
    GROUP BY os_name, install_os
    ORDER BY installs DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Attribution by channel from raw events. Supports device_os filter.
 */
exports.queryAttributionByChannelFromRaw = async function (window, osFilter) {
  const os = osFilterClause(osFilter);
  const q = `
    SELECT event_name, ifNull(properties['channel'], '') AS channel, ifNull(properties['source_name'], '') AS source_name,
      count() AS total_events, sum(revenue) AS total_revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND ${utcTimestampPrewhere(window)} ${os}
    GROUP BY event_name, channel, source_name
    ORDER BY total_events DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Funnel counts. Returns os_name, install_os, event_name. Service derives os_family and aggregates.
 */
exports.queryFunnelMetricsByOs = async function (window) {
  const q = `
    SELECT
      ifNull(os_name, '') AS os_name,
      ifNull(properties['install_os'], '') AS install_os,
      event_name,
      count() AS cnt,
      sum(revenue) AS total_revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name IN ('app_open', 'attributed_install', 'attributed_signup', 'attributed_add_to_cart', 'attributed_purchase')
      AND ${utcTimestampPrewhere(window)}
    GROUP BY os_name, install_os, event_name
    ORDER BY os_name, install_os, event_name
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Funnel counts for specific object_ids. Same shape: os_name, install_os, event_name.
 */
exports.queryFunnelMetricsByOsForObjectIds = async function (objectIds, window) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const q = `
    SELECT
      ifNull(os_name, '') AS os_name,
      ifNull(properties['install_os'], '') AS install_os,
      event_name,
      count() AS cnt,
      sum(revenue) AS total_revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name IN ('app_open', 'attributed_install', 'attributed_signup', 'attributed_add_to_cart', 'attributed_purchase')
      AND ${utcTimestampPrewhere(window)}
      AND object_id IN (${ids})
    GROUP BY os_name, install_os, event_name
    ORDER BY os_name, install_os, event_name
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Installs for specific object_ids. Returns os_name, install_os for service to derive os_family.
 */
exports.queryInstallsByOsForObjectIds = async function (objectIds, window, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const q = `
    SELECT
      ifNull(os_name, '') AS os_name,
      ifNull(properties['install_os'], '') AS install_os,
      count() AS installs
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_install'
      AND ${utcTimestampPrewhere(window)}
      AND object_id IN (${ids})
      ${os}
    GROUP BY os_name, install_os
    ORDER BY installs DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Attribution by channel for specific object_ids.
 */
exports.queryAttributionByChannelFromRawForObjectIds = async function (objectIds, window, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const q = `
    SELECT event_name, ifNull(properties['channel'], '') AS channel, ifNull(properties['source_name'], '') AS source_name,
      count() AS total_events, sum(revenue) AS total_revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND ${utcTimestampPrewhere(window)} AND object_id IN (${ids}) ${os}
    GROUP BY event_name, channel, source_name
    ORDER BY total_events DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Clicks per channel for specific link_ids.
 */
exports.queryClicksByChannelForLinkIds = async function (linkIds, window) {
  const ids = objectIdsClause(linkIds);
  if (!ids) return [];
  const q = `
    SELECT
      ifNull(channel, '') AS channel,
      count() AS clicks
    FROM link_clicks
    WHERE link_id IN (${ids})
      AND ${linkClickTimestampPrewhere(window)}
    GROUP BY channel
    ORDER BY clicks DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Signups in range. Returns auth_attribution_occasion (may be empty). Service maps '' to 'unknown'.
 */
exports.querySignupsByAuthOccasion = async function (window, osFilter) {
  const os = osFilterClause(osFilter);
  const q = `
    SELECT
      ifNull(properties['auth_attribution_occasion'], '') AS auth_occasion,
      count() AS signups
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_signup'
      AND ${utcTimestampPrewhere(window)}
      ${os}
    GROUP BY auth_occasion
    ORDER BY signups DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Signups for object_ids. Same shape.
 */
exports.querySignupsByAuthOccasionForObjectIds = async function (objectIds, window, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const q = `
    SELECT
      ifNull(properties['auth_attribution_occasion'], '') AS auth_occasion,
      count() AS signups
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_signup'
      AND ${utcTimestampPrewhere(window)}
      AND object_id IN (${ids})
      ${os}
    GROUP BY auth_occasion
    ORDER BY signups DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Link clicks per link_id in time range (not filtered by device OS).
 */
exports.queryClickCountsByLinkIds = async function (linkIds, window) {
  const ids = objectIdsClause(linkIds);
  if (!ids) return [];
  const q = `
    SELECT link_id, count() AS clicks
    FROM link_clicks
    WHERE link_id IN (${ids})
      AND ${linkClickTimestampPrewhere(window)}
    GROUP BY link_id
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Total link clicks for one or more link_ids.
 */
exports.queryClickCountForLinkIds = async function (linkIds, window) {
  const ids = objectIdsClause(linkIds);
  if (!ids) return { total: 0 };
  const q = `
    SELECT count() AS total
    FROM link_clicks
    WHERE link_id IN (${ids})
      AND ${linkClickTimestampPrewhere(window)}
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  const row = result.data && result.data[0];
  return { total: row ? Number(row.total) : 0 };
};

/**
 * Attribution funnel counts per object_id (tracking link) for list stitching.
 */
exports.queryAttributionEventCountsByObjectIds = async function (objectIds, window, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const q = `
    SELECT object_id, event_name, count() AS cnt
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name IN ('app_open', 'attributed_install', 'attributed_signup', 'attributed_add_to_cart', 'attributed_purchase')
      AND ${utcTimestampPrewhere(window)}
      AND object_id IN (${ids}) ${os}
    GROUP BY object_id, event_name
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Attribution events by event_name for object_ids.
 */
exports.queryAttributionEventsForObjectIds = async function (objectIds, window, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const q = `
    SELECT event_name, count() AS cnt, sum(revenue) AS revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND ${utcTimestampPrewhere(window)} AND object_id IN (${ids}) ${os}
    GROUP BY event_name
    ORDER BY cnt DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Add-to-cart and purchase events by plan for object_ids.
 */
exports.queryAttributionEventsByPlanForObjectIds = async function (objectIds, window, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const q = `
    SELECT event_name, ifNull(properties['plan_id'], '') AS plan_id, ifNull(properties['plan_name'], '') AS plan_name,
      count() AS cnt, sum(revenue) AS revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND event_name IN ('attributed_add_to_cart', 'attributed_purchase')
      AND ${utcTimestampPrewhere(window)} AND object_id IN (${ids}) ${os}
    GROUP BY event_name, plan_id, plan_name
    ORDER BY event_name ASC, cnt DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Daily app opens for object_ids.
 */
exports.queryAppOpensByDayForObjectIds = async function (objectIds, window, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const dayExpr = clientDayExpr(window.tz);
  const q = `
    SELECT ${dayExpr} AS day, count() AS app_opens
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND event_name = 'app_open' AND ${utcTimestampPrewhere(window)} AND object_id IN (${ids}) ${os}
    GROUP BY day
    ORDER BY day ASC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Daily installs for object_ids.
 */
exports.queryInstallsByDayForObjectIds = async function (objectIds, window, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const dayExpr = clientDayExpr(window.tz);
  const q = `
    SELECT ${dayExpr} AS day, count() AS installs
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND event_name = 'attributed_install' AND ${utcTimestampPrewhere(window)} AND object_id IN (${ids}) ${os}
    GROUP BY day
    ORDER BY day ASC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Daily purchases for object_ids.
 */
exports.queryPurchasesByDayForObjectIds = async function (objectIds, window, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const dayExpr = clientDayExpr(window.tz);
  const q = `
    SELECT ${dayExpr} AS day, count() AS purchases, sum(revenue) AS revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND event_name = 'attributed_purchase' AND ${utcTimestampPrewhere(window)} AND object_id IN (${ids}) ${os}
    GROUP BY day
    ORDER BY day ASC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * User purchase counts. Simple: user_id, cnt. Service filters cnt >= 2 for repeat_buyers.
 */
exports.queryPurchaseCountsByUser = async function (objectIds, window, osFilter) {
  const ids = objectIdsClause(objectIds);
  const idClause = ids ? `AND object_id IN (${ids})` : '';
  const os = osFilterClause(osFilter);
  const q = `
    SELECT user_id, count() AS cnt
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_purchase'
      AND ${utcTimestampPrewhere(window)}
      AND ifNull(user_id, '') != ''
      ${idClause}
      ${os}
    GROUP BY user_id
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Purchase events grouped by purchase_ordinal. Simple. Service aggregates first/repeat.
 */
exports.queryPurchasesByOrdinal = async function (objectIds, window, osFilter) {
  const ids = objectIdsClause(objectIds);
  const idClause = ids ? `AND object_id IN (${ids})` : '';
  const os = osFilterClause(osFilter);
  const q = `
    SELECT ifNull(properties['purchase_ordinal'], '0') AS purchase_ordinal, count() AS cnt
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_purchase'
      AND ${utcTimestampPrewhere(window)}
      ${idClause}
      ${os}
    GROUP BY purchase_ordinal
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Individual click events for timeline.
 */
exports.queryClickEventsForLinkIds = async function (linkIds, window, limit = 50, offset = 0) {
  const ids = objectIdsClause(linkIds);
  if (!ids) return [];
  const limitNum = Math.max(1, Math.min(Number(limit) || 50, 200));
  const offsetNum = Math.max(0, Number(offset) || 0);
  const q = `
    SELECT
      timestamp,
      click_id,
      link_id,
      short_code,
      channel,
      source_name,
      campaign,
      ip_address,
      user_agent,
      country
    FROM link_clicks
    WHERE link_id IN (${ids})
      AND ${linkClickTimestampPrewhere(window)}
    ORDER BY timestamp DESC
    LIMIT ${limitNum} OFFSET ${offsetNum}
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Count total clicks for pagination.
 */
exports.queryClickEventsCountForLinkIds = async function (linkIds, window) {
  const ids = objectIdsClause(linkIds);
  if (!ids) return 0;
  const q = `
    SELECT count() AS total
    FROM link_clicks
    WHERE link_id IN (${ids})
      AND ${linkClickTimestampPrewhere(window)}
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  const row = result.data && result.data[0];
  return row ? Number(row.total) : 0;
};

/**
 * Attribution events for timeline. Service stitches with clicks.
 */
exports.queryAttributionEventsForTimeline = async function (objectIds, window) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const q = `
    SELECT
      timestamp,
      event_name,
      revenue,
      ifNull(properties['plan_id'], '') AS plan_id,
      ifNull(properties['plan_name'], '') AS plan_name,
      ifNull(properties['channel'], '') AS channel,
      ifNull(properties['source_name'], '') AS source_name,
      ifNull(properties['auth_attribution_occasion'], '') AS auth_attribution_occasion,
      ifNull(properties['purchase_ordinal'], '') AS purchase_ordinal,
      ifNull(properties['is_first_attributed_purchase'], '') AS is_first_attributed_purchase,
      ifNull(properties['app_user_id'], '') AS app_user_id_prop,
      ifNull(os_name, '') AS os_name,
      ifNull(properties['install_os'], '') AS install_os,
      device_id,
      user_id
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND ${utcTimestampPrewhere(window)} AND object_id IN (${ids})
    ORDER BY timestamp DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Count attribution events for timeline.
 */
exports.queryAttributionEventsCountForTimeline = async function (objectIds, window) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return 0;
  const q = `
    SELECT count() AS total
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND ${utcTimestampPrewhere(window)} AND object_id IN (${ids})
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  const row = result.data && result.data[0];
  return row ? Number(row.total) : 0;
};

/**
 * Click events for timeline. Service stitches with attribution events.
 */
exports.queryClickEventsForTimeline = async function (linkIds, window) {
  const ids = objectIdsClause(linkIds);
  if (!ids) return [];
  const q = `
    SELECT
      timestamp,
      click_id,
      link_id,
      short_code,
      channel,
      source_name,
      campaign,
      ip_address,
      user_agent,
      country
    FROM link_clicks
    WHERE link_id IN (${ids})
      AND ${linkClickTimestampPrewhere(window)}
    ORDER BY timestamp DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Count click events for timeline.
 */
exports.queryClickEventsCountForTimeline = async function (linkIds, window) {
  const ids = objectIdsClause(linkIds);
  if (!ids) return 0;
  const q = `
    SELECT count() AS total
    FROM link_clicks
    WHERE link_id IN (${ids})
      AND ${linkClickTimestampPrewhere(window)}
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  const row = result.data && result.data[0];
  return row ? Number(row.total) : 0;
};

/**
 * Attribution events grouped by channel_group (v2 spoke).
 */
/**
 * Attribution events by channel_group from raw (client-calendar window).
 */
exports.queryAttributionByChannelGroupFromRaw = async function (window, osFilter) {
  const os = osFilterClause(osFilter);
  const q = `
    SELECT
      event_name,
      properties['channel_group'] AS channel_group,
      count() AS total_events,
      sum(revenue) AS total_revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND ${utcTimestampPrewhere(window)} ${os}
    GROUP BY event_name, properties['channel_group']
    ORDER BY total_events DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Link clicks grouped by channel_group (v2 roll-up).
 */
/**
 * Link clicks by channel_group from link_clicks (client-calendar UTC window).
 */
exports.queryClicksByChannelGroupFromRaw = async function (window) {
  const q = `
    SELECT
      channel_group,
      count() AS clicks
    FROM link_clicks
    WHERE ${linkClickTimestampPrewhere(window)}
    GROUP BY channel_group
    ORDER BY clicks DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Channel-group stats filtered by link object_ids (profile/link detail).
 */
exports.queryAttributionByChannelGroupForObjectIds = async function (objectIds, window, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const q = `
    SELECT
      event_name,
      properties['channel_group'] AS channel_group,
      count() AS total_events,
      sum(revenue) AS total_revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND object_id IN (${ids})
      AND ${utcTimestampPrewhere(window)} ${os}
    GROUP BY event_name, properties['channel_group']
    ORDER BY total_events DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

exports.queryClicksByChannelGroupForLinkIds = async function (linkIds, window) {
  const ids = objectIdsClause(linkIds);
  if (!ids) return [];
  const q = `
    SELECT
      channel_group,
      count() AS clicks
    FROM link_clicks
    WHERE link_id IN (${ids})
      AND ${linkClickTimestampPrewhere(window)}
    GROUP BY channel_group
    ORDER BY clicks DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Total attribution events in range (v2 roll-up — no raw scan).
 */
exports.queryClassificationEventTotalsFromRaw = async function (window) {
  const q = `
    SELECT
      count() AS total_events,
      countIf(toUInt16OrZero(ifNull(properties['classification_version'], '0')) > 0) AS classified_events
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND ${utcTimestampPrewhere(window)}
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  const row = result.data && result.data[0];
  return {
    total_events: row ? Number(row.total_events) || 0 : 0,
    classified_events: row ? Number(row.classified_events) || 0 : 0
  };
};

/**
 * Channel group distribution from raw (client-calendar window).
 */
exports.queryClassificationDistributionFromRaw = async function (window) {
  const q = `
    SELECT
      properties['channel_group'] AS channel_group,
      count() AS total_events,
      max(toUInt16OrZero(ifNull(properties['classification_version'], '0'))) AS classification_version
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND ${utcTimestampPrewhere(window)}
    GROUP BY channel_group
    ORDER BY total_events DESC
    LIMIT 50
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

function channelGroupWhereClause(normalizedGroup) {
  const g = String(normalizedGroup || '').trim();
  if (!g || g === 'Unassigned (legacy)') {
    return "(properties['channel_group'] = '' OR isNull(properties['channel_group']))";
  }
  return `properties['channel_group'] = '${esc(g)}'`;
}

function numField(row, ...keys) {
  for (const k of keys) {
    if (row[k] != null && row[k] !== '') {
      const n = Number(row[k]);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

function strField(row, key) {
  const v = row[key];
  return v != null && String(v).trim() !== '' ? String(v) : '';
}

function normalizeEventBreakdownRows(rows) {
  return (rows || []).map((row) => ({
    media_source: strField(row, 'media_source'),
    medium: strField(row, 'medium'),
    classification_reason: strField(row, 'classification_reason'),
    legacy_channel: strField(row, 'legacy_channel'),
    attribution_method: strField(row, 'attribution_method'),
    utm_source: strField(row, 'utm_source'),
    utm_campaign: strField(row, 'utm_campaign'),
    event_name: strField(row, 'event_name'),
    total_events: numField(row, 'cnt', 'total_events', 'CNT', 'TOTAL_EVENTS'),
    total_revenue: numField(row, 'revenue', 'total_revenue', 'REVENUE', 'TOTAL_REVENUE')
  }));
}

exports.queryChannelGroupFunnelFromRaw = async function (window, channelGroup, osFilter, objectIds) {
  const os = osFilterClause(osFilter);
  const cgFilter = channelGroupWhereClause(channelGroup);
  let objectFilter = '';
  if (objectIds && objectIds.length) {
    const ids = objectIdsClause(objectIds);
    if (ids) objectFilter = ` AND object_id IN (${ids}) `;
  }
  const q = `
    SELECT event_name, count() AS cnt, sum(revenue) AS revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND ${utcTimestampPrewhere(window)}
      AND ${cgFilter}
      ${objectFilter}
      ${os}
    GROUP BY event_name
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

exports.queryChannelGroupEventBreakdownFromRaw = async function (window, channelGroup, osFilter, objectIds) {
  const os = osFilterClause(osFilter);
  const cgFilter = channelGroupWhereClause(channelGroup);
  let objectFilter = '';
  if (objectIds && objectIds.length) {
    const ids = objectIdsClause(objectIds);
    if (ids) objectFilter = ` AND object_id IN (${ids}) `;
  }
  const q = `
    SELECT
      properties['media_source'] AS media_source,
      properties['medium'] AS medium,
      properties['classification_reason'] AS classification_reason,
      properties['channel'] AS legacy_channel,
      properties['attribution_method'] AS attribution_method,
      properties['utm_source'] AS utm_source,
      properties['utm_campaign'] AS utm_campaign,
      event_name,
      count() AS cnt,
      sum(revenue) AS revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND ${utcTimestampPrewhere(window)}
      AND ${cgFilter}
      ${objectFilter}
      ${os}
    GROUP BY
      properties['media_source'],
      properties['medium'],
      properties['classification_reason'],
      properties['channel'],
      properties['attribution_method'],
      properties['utm_source'],
      properties['utm_campaign'],
      event_name
    ORDER BY cnt DESC
    LIMIT 200
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return normalizeEventBreakdownRows(result.data);
};

exports.queryChannelGroupClickBreakdownFromRaw = async function (window, channelGroup, linkIds) {
  const g = String(channelGroup || '').trim();
  let cgFilter;
  if (!g || g === 'Unassigned (legacy)') {
    cgFilter = "(channel_group = '' OR isNull(channel_group))";
  } else {
    cgFilter = `channel_group = '${esc(g)}'`;
  }
  let linkFilter = '';
  if (linkIds && linkIds.length) {
    const ids = objectIdsClause(linkIds);
    if (ids) linkFilter = ` AND link_id IN (${ids}) `;
  }
  const q = `
    SELECT
      media_source,
      medium,
      classification_reason,
      campaign,
      count() AS clicks
    FROM link_clicks
    WHERE ${linkClickTimestampPrewhere(window)}
      AND ${cgFilter}
      ${linkFilter}
    GROUP BY media_source, medium, classification_reason, campaign
    ORDER BY clicks DESC
    LIMIT 100
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

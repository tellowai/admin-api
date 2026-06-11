'use strict';

const { slaveClickhouse } = require('../../../config/lib/clickhouse');

function esc(str) {
  return String(str).replace(/'/g, "''");
}

/** Simple date filter for analytics_events_raw. */
function dateRangeClause(startDate, endDate) {
  return `toDate(timestamp) >= toDate('${esc(startDate)}') AND toDate(timestamp) <= toDate('${esc(endDate)}')`;
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
exports.queryAttributionByChannel = async function (startDate, endDate) {
  const q = `
    SELECT
      event_name,
      channel,
      source_name,
      sum(total_events) AS total_events,
      sum(total_revenue) AS total_revenue
    FROM attribution_daily_stats
    WHERE report_date >= '${esc(startDate)}' AND report_date <= '${esc(endDate)}'
    GROUP BY event_name, channel, source_name
    ORDER BY total_events DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Clicks per short_code in time range.
 */
exports.queryClicksByShortCode = async function (startTs, endTs) {
  const q = `
    SELECT
      short_code,
      count() AS clicks
    FROM link_clicks
    WHERE timestamp >= parseDateTimeBestEffort('${esc(startTs)}')
      AND timestamp <= parseDateTimeBestEffort('${esc(endTs)}')
    GROUP BY short_code
    ORDER BY clicks DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Clicks per channel in time range (from link_clicks.channel). Used for Performance by channel.
 */
exports.queryClicksByChannel = async function (startTs, endTs) {
  const q = `
    SELECT
      ifNull(channel, '') AS channel,
      count() AS clicks
    FROM link_clicks
    WHERE timestamp >= parseDateTimeBestEffort('${esc(startTs)}')
      AND timestamp <= parseDateTimeBestEffort('${esc(endTs)}')
    GROUP BY channel
    ORDER BY clicks DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Daily app opens for overview chart (platform-wide).
 */
exports.queryAppOpensByDay = async function (startDate, endDate, osFilter) {
  const os = osFilterClause(osFilter);
  const q = `
    SELECT toDate(timestamp) AS day, ifNull(properties['channel'], '') AS channel, count() AS app_opens
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND event_name = 'app_open' AND ${dateRangeClause(startDate, endDate)} ${os}
    GROUP BY day, channel
    ORDER BY day ASC, channel ASC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Daily install events for chart.
 */
exports.queryInstallsByDay = async function (startDate, endDate, osFilter) {
  const os = osFilterClause(osFilter);
  const q = `
    SELECT toDate(timestamp) AS day, ifNull(properties['channel'], '') AS channel, count() AS installs
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND event_name = 'attributed_install' AND ${dateRangeClause(startDate, endDate)} ${os}
    GROUP BY day, channel
    ORDER BY day ASC, channel ASC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Installs in range. Returns os_name and install_os for service to derive os_family.
 */
exports.queryInstallsByOs = async function (startDate, endDate, osFilter) {
  const os = osFilterClause(osFilter);
  const q = `
    SELECT
      ifNull(os_name, '') AS os_name,
      ifNull(properties['install_os'], '') AS install_os,
      count() AS installs
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_install'
      AND ${dateRangeClause(startDate, endDate)}
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
exports.queryAttributionByChannelFromRaw = async function (startDate, endDate, osFilter) {
  const os = osFilterClause(osFilter);
  const q = `
    SELECT event_name, ifNull(properties['channel'], '') AS channel, ifNull(properties['source_name'], '') AS source_name,
      count() AS total_events, sum(revenue) AS total_revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND ${dateRangeClause(startDate, endDate)} ${os}
    GROUP BY event_name, channel, source_name
    ORDER BY total_events DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Funnel counts. Returns os_name, install_os, event_name. Service derives os_family and aggregates.
 */
exports.queryFunnelMetricsByOs = async function (startDate, endDate) {
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
      AND ${dateRangeClause(startDate, endDate)}
    GROUP BY os_name, install_os, event_name
    ORDER BY os_name, install_os, event_name
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Funnel counts for specific object_ids. Same shape: os_name, install_os, event_name.
 */
exports.queryFunnelMetricsByOsForObjectIds = async function (objectIds, startDate, endDate) {
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
      AND ${dateRangeClause(startDate, endDate)}
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
exports.queryInstallsByOsForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
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
      AND ${dateRangeClause(startDate, endDate)}
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
exports.queryAttributionByChannelFromRawForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const q = `
    SELECT event_name, ifNull(properties['channel'], '') AS channel, ifNull(properties['source_name'], '') AS source_name,
      count() AS total_events, sum(revenue) AS total_revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND ${dateRangeClause(startDate, endDate)} AND object_id IN (${ids}) ${os}
    GROUP BY event_name, channel, source_name
    ORDER BY total_events DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Clicks per channel for specific link_ids.
 */
exports.queryClicksByChannelForLinkIds = async function (linkIds, startTs, endTs) {
  const ids = objectIdsClause(linkIds);
  if (!ids) return [];
  const q = `
    SELECT
      ifNull(channel, '') AS channel,
      count() AS clicks
    FROM link_clicks
    WHERE link_id IN (${ids})
      AND timestamp >= parseDateTimeBestEffort('${esc(startTs)}')
      AND timestamp <= parseDateTimeBestEffort('${esc(endTs)}')
    GROUP BY channel
    ORDER BY clicks DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Signups in range. Returns auth_attribution_occasion (may be empty). Service maps '' to 'unknown'.
 */
exports.querySignupsByAuthOccasion = async function (startDate, endDate, osFilter) {
  const os = osFilterClause(osFilter);
  const q = `
    SELECT
      ifNull(properties['auth_attribution_occasion'], '') AS auth_occasion,
      count() AS signups
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_signup'
      AND ${dateRangeClause(startDate, endDate)}
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
exports.querySignupsByAuthOccasionForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
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
      AND ${dateRangeClause(startDate, endDate)}
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
exports.queryClickCountsByLinkIds = async function (linkIds, startTs, endTs) {
  const ids = objectIdsClause(linkIds);
  if (!ids) return [];
  const q = `
    SELECT link_id, count() AS clicks
    FROM link_clicks
    WHERE link_id IN (${ids})
      AND timestamp >= parseDateTimeBestEffort('${esc(startTs)}')
      AND timestamp <= parseDateTimeBestEffort('${esc(endTs)}')
    GROUP BY link_id
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Total link clicks for one or more link_ids.
 */
exports.queryClickCountForLinkIds = async function (linkIds, startTs, endTs) {
  const ids = objectIdsClause(linkIds);
  if (!ids) return { total: 0 };
  const q = `
    SELECT count() AS total
    FROM link_clicks
    WHERE link_id IN (${ids})
      AND timestamp >= parseDateTimeBestEffort('${esc(startTs)}')
      AND timestamp <= parseDateTimeBestEffort('${esc(endTs)}')
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  const row = result.data && result.data[0];
  return { total: row ? Number(row.total) : 0 };
};

/**
 * Attribution funnel counts per object_id (tracking link) for list stitching.
 */
exports.queryAttributionEventCountsByObjectIds = async function (objectIds, startDate, endDate, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const q = `
    SELECT object_id, event_name, count() AS cnt
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name IN ('app_open', 'attributed_install', 'attributed_signup', 'attributed_add_to_cart', 'attributed_purchase')
      AND ${dateRangeClause(startDate, endDate)}
      AND object_id IN (${ids}) ${os}
    GROUP BY object_id, event_name
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Attribution events by event_name for object_ids.
 */
exports.queryAttributionEventsForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const q = `
    SELECT event_name, count() AS cnt, sum(revenue) AS revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND ${dateRangeClause(startDate, endDate)} AND object_id IN (${ids}) ${os}
    GROUP BY event_name
    ORDER BY cnt DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Add-to-cart and purchase events by plan for object_ids.
 */
exports.queryAttributionEventsByPlanForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const q = `
    SELECT event_name, ifNull(properties['plan_id'], '') AS plan_id, ifNull(properties['plan_name'], '') AS plan_name,
      count() AS cnt, sum(revenue) AS revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND event_name IN ('attributed_add_to_cart', 'attributed_purchase')
      AND ${dateRangeClause(startDate, endDate)} AND object_id IN (${ids}) ${os}
    GROUP BY event_name, plan_id, plan_name
    ORDER BY event_name ASC, cnt DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Daily app opens for object_ids.
 */
exports.queryAppOpensByDayForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const q = `
    SELECT toDate(timestamp) AS day, count() AS app_opens
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND event_name = 'app_open' AND ${dateRangeClause(startDate, endDate)} AND object_id IN (${ids}) ${os}
    GROUP BY day
    ORDER BY day ASC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Daily installs for object_ids.
 */
exports.queryInstallsByDayForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const q = `
    SELECT toDate(timestamp) AS day, count() AS installs
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND event_name = 'attributed_install' AND ${dateRangeClause(startDate, endDate)} AND object_id IN (${ids}) ${os}
    GROUP BY day
    ORDER BY day ASC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Daily purchases for object_ids.
 */
exports.queryPurchasesByDayForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return [];
  const os = osFilterClause(osFilter);
  const q = `
    SELECT toDate(timestamp) AS day, count() AS purchases, sum(revenue) AS revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND event_name = 'attributed_purchase' AND ${dateRangeClause(startDate, endDate)} AND object_id IN (${ids}) ${os}
    GROUP BY day
    ORDER BY day ASC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * User purchase counts. Simple: user_id, cnt. Service filters cnt >= 2 for repeat_buyers.
 */
exports.queryPurchaseCountsByUser = async function (objectIds, startDate, endDate, osFilter) {
  const ids = objectIdsClause(objectIds);
  const idClause = ids ? `AND object_id IN (${ids})` : '';
  const os = osFilterClause(osFilter);
  const q = `
    SELECT user_id, count() AS cnt
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_purchase'
      AND ${dateRangeClause(startDate, endDate)}
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
exports.queryPurchasesByOrdinal = async function (objectIds, startDate, endDate, osFilter) {
  const ids = objectIdsClause(objectIds);
  const idClause = ids ? `AND object_id IN (${ids})` : '';
  const os = osFilterClause(osFilter);
  const q = `
    SELECT ifNull(properties['purchase_ordinal'], '0') AS purchase_ordinal, count() AS cnt
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_purchase'
      AND ${dateRangeClause(startDate, endDate)}
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
exports.queryClickEventsForLinkIds = async function (linkIds, startTs, endTs, limit = 50, offset = 0) {
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
      AND timestamp >= parseDateTimeBestEffort('${esc(startTs)}')
      AND timestamp <= parseDateTimeBestEffort('${esc(endTs)}')
    ORDER BY timestamp DESC
    LIMIT ${limitNum} OFFSET ${offsetNum}
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Count total clicks for pagination.
 */
exports.queryClickEventsCountForLinkIds = async function (linkIds, startTs, endTs) {
  const ids = objectIdsClause(linkIds);
  if (!ids) return 0;
  const q = `
    SELECT count() AS total
    FROM link_clicks
    WHERE link_id IN (${ids})
      AND timestamp >= parseDateTimeBestEffort('${esc(startTs)}')
      AND timestamp <= parseDateTimeBestEffort('${esc(endTs)}')
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  const row = result.data && result.data[0];
  return row ? Number(row.total) : 0;
};

/**
 * Attribution events for timeline. Service stitches with clicks.
 */
exports.queryAttributionEventsForTimeline = async function (objectIds, startDate, endDate) {
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
    WHERE object_type = 'attribution' AND ${dateRangeClause(startDate, endDate)} AND object_id IN (${ids})
    ORDER BY timestamp DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Count attribution events for timeline.
 */
exports.queryAttributionEventsCountForTimeline = async function (objectIds, startDate, endDate) {
  const ids = objectIdsClause(objectIds);
  if (!ids) return 0;
  const q = `
    SELECT count() AS total
    FROM analytics_events_raw
    WHERE object_type = 'attribution' AND ${dateRangeClause(startDate, endDate)} AND object_id IN (${ids})
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  const row = result.data && result.data[0];
  return row ? Number(row.total) : 0;
};

/**
 * Click events for timeline. Service stitches with attribution events.
 */
exports.queryClickEventsForTimeline = async function (linkIds, startTs, endTs) {
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
      AND timestamp >= parseDateTimeBestEffort('${esc(startTs)}')
      AND timestamp <= parseDateTimeBestEffort('${esc(endTs)}')
    ORDER BY timestamp DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Count click events for timeline.
 */
exports.queryClickEventsCountForTimeline = async function (linkIds, startTs, endTs) {
  const ids = objectIdsClause(linkIds);
  if (!ids) return 0;
  const q = `
    SELECT count() AS total
    FROM link_clicks
    WHERE link_id IN (${ids})
      AND timestamp >= parseDateTimeBestEffort('${esc(startTs)}')
      AND timestamp <= parseDateTimeBestEffort('${esc(endTs)}')
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  const row = result.data && result.data[0];
  return row ? Number(row.total) : 0;
};

/**
 * Attribution events grouped by channel_group (v2 spoke).
 */
exports.queryAttributionByChannelGroupV2 = async function (startDate, endDate) {
  const q = `
    SELECT
      event_name,
      channel_group,
      sum(total_events) AS total_events,
      sum(total_revenue) AS total_revenue
    FROM attribution_daily_stats_v2
    WHERE report_date >= '${esc(startDate)}' AND report_date <= '${esc(endDate)}'
    GROUP BY event_name, channel_group
    ORDER BY total_events DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Attribution events by channel_group from raw (when OS filter applied).
 */
exports.queryAttributionByChannelGroupFromRaw = async function (startDate, endDate, osFilter) {
  const os = osFilterClause(osFilter);
  const q = `
    SELECT
      event_name,
      properties['channel_group'] AS channel_group,
      count() AS total_events,
      sum(revenue) AS total_revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND ${dateRangeClause(startDate, endDate)} ${os}
    GROUP BY event_name, properties['channel_group']
    ORDER BY total_events DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Link clicks grouped by channel_group (v2 roll-up).
 */
exports.queryClicksByChannelGroup = async function (startDate, endDate) {
  const q = `
    SELECT
      channel_group,
      sum(total_clicks) AS clicks
    FROM link_clicks_daily_stats
    WHERE report_date >= '${esc(startDate)}' AND report_date <= '${esc(endDate)}'
    GROUP BY channel_group
    ORDER BY clicks DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Link clicks by channel_group from link_clicks (fallback when daily roll-up MV is empty / missing).
 */
exports.queryClicksByChannelGroupFromRaw = async function (startTs, endTs) {
  const q = `
    SELECT
      channel_group,
      count() AS clicks
    FROM link_clicks
    WHERE timestamp >= parseDateTimeBestEffort('${esc(startTs)}')
      AND timestamp <= parseDateTimeBestEffort('${esc(endTs)}')
    GROUP BY channel_group
    ORDER BY clicks DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Channel-group stats filtered by link object_ids (profile/link detail).
 */
exports.queryAttributionByChannelGroupForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
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
      AND ${dateRangeClause(startDate, endDate)} ${os}
    GROUP BY event_name, properties['channel_group']
    ORDER BY total_events DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

exports.queryClicksByChannelGroupForLinkIds = async function (linkIds, startTs, endTs) {
  const ids = objectIdsClause(linkIds);
  if (!ids) return [];
  const q = `
    SELECT
      channel_group,
      count() AS clicks
    FROM link_clicks
    WHERE link_id IN (${ids})
      AND timestamp >= parseDateTimeBestEffort('${esc(startTs)}')
      AND timestamp <= parseDateTimeBestEffort('${esc(endTs)}')
    GROUP BY channel_group
    ORDER BY clicks DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Total attribution events in range (v2 roll-up — no raw scan).
 */
exports.queryClassificationEventTotalsV2 = async function (startDate, endDate) {
  const q = `
    SELECT
      sum(total_events) AS total_events,
      sumIf(total_events, classification_version > 0) AS classified_events
    FROM attribution_daily_stats_v2
    WHERE report_date >= '${esc(startDate)}' AND report_date <= '${esc(endDate)}'
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  const row = result.data && result.data[0];
  return {
    total_events: row ? Number(row.total_events) || 0 : 0,
    classified_events: row ? Number(row.classified_events) || 0 : 0
  };
};

/**
 * Channel group distribution (v2 roll-up).
 */
exports.queryClassificationDistributionV2 = async function (startDate, endDate) {
  const q = `
    SELECT
      channel_group,
      sum(total_events) AS total_events,
      max(classification_version) AS classification_version
    FROM attribution_daily_stats_v2
    WHERE report_date >= '${esc(startDate)}' AND report_date <= '${esc(endDate)}'
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

exports.queryChannelGroupEventBreakdownFromRaw = async function (
  startDate,
  endDate,
  channelGroup,
  osFilter,
  objectIds
) {
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
      count() AS total_events,
      sum(revenue) AS total_revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND ${dateRangeClause(startDate, endDate)}
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
    ORDER BY total_events DESC
    LIMIT 200
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

exports.queryChannelGroupClickBreakdownFromRaw = async function (startTs, endTs, channelGroup, linkIds) {
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
    WHERE timestamp >= parseDateTimeBestEffort('${esc(startTs)}')
      AND timestamp <= parseDateTimeBestEffort('${esc(endTs)}')
      AND ${cgFilter}
      ${linkFilter}
    GROUP BY media_source, medium, classification_reason, campaign
    ORDER BY clicks DESC
    LIMIT 100
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

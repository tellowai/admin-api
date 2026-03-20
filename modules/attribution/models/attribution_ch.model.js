'use strict';

const { slaveClickhouse } = require('../../../config/lib/clickhouse');

function esc(str) {
  return String(str).replace(/'/g, "''");
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
 * Daily install events for chart (from raw for flexibility if MV lags).
 */
exports.queryInstallsByDay = async function (startDate, endDate) {
  const q = `
    SELECT
      toDate(timestamp) AS day,
      ifNull(properties['channel'], '') AS channel,
      count() AS installs
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_install'
      AND toDate(timestamp) >= toDate('${esc(startDate)}')
      AND toDate(timestamp) <= toDate('${esc(endDate)}')
    GROUP BY day, channel
    ORDER BY day ASC, channel ASC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Total link clicks for one or more link_ids in a time window.
 */
exports.queryClickCountForLinkIds = async function (linkIds, startTs, endTs) {
  if (!linkIds || !linkIds.length) return { total: 0 };
  const ids = linkIds.map((id) => `'${esc(String(id))}'`).join(',');
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
 * Attribution events (installs, signups, purchases) keyed by tracking link id in object_id.
 */
exports.queryAttributionEventsForObjectIds = async function (objectIds, startDate, endDate) {
  if (!objectIds || !objectIds.length) return [];
  const ids = objectIds.map((id) => `'${esc(String(id))}'`).join(',');
  const q = `
    SELECT
      event_name,
      count() AS cnt,
      sum(revenue) AS revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND toDate(timestamp) >= toDate('${esc(startDate)}')
      AND toDate(timestamp) <= toDate('${esc(endDate)}')
      AND object_id IN (${ids})
    GROUP BY event_name
    ORDER BY count() DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Attribution events (add to cart, purchase) broken down by plan for link stats.
 * Uses plan_id, plan_name from properties Map; events without plan show as empty string.
 */
exports.queryAttributionEventsByPlanForObjectIds = async function (objectIds, startDate, endDate) {
  if (!objectIds || !objectIds.length) return [];
  const ids = objectIds.map((id) => `'${esc(String(id))}'`).join(',');
  const q = `
    SELECT
      event_name,
      ifNull(properties['plan_id'], '') AS plan_id,
      ifNull(properties['plan_name'], '') AS plan_name,
      count() AS cnt,
      sum(revenue) AS revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name IN ('attributed_add_to_cart', 'attributed_purchase')
      AND toDate(timestamp) >= toDate('${esc(startDate)}')
      AND toDate(timestamp) <= toDate('${esc(endDate)}')
      AND object_id IN (${ids})
    GROUP BY event_name, plan_id, plan_name
    ORDER BY event_name ASC, cnt DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Daily installs for chart (object_id = tracking link id).
 */
exports.queryInstallsByDayForObjectIds = async function (objectIds, startDate, endDate) {
  if (!objectIds || !objectIds.length) return [];
  const ids = objectIds.map((id) => `'${esc(String(id))}'`).join(',');
  const q = `
    SELECT
      toDate(timestamp) AS day,
      count() AS installs
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_install'
      AND toDate(timestamp) >= toDate('${esc(startDate)}')
      AND toDate(timestamp) <= toDate('${esc(endDate)}')
      AND object_id IN (${ids})
    GROUP BY day
    ORDER BY day ASC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Daily attributed purchases for chart (same object_id = tracking link id as installs).
 * Populated when clients POST attributed_purchase with link_id / click_id resolution.
 */
exports.queryPurchasesByDayForObjectIds = async function (objectIds, startDate, endDate) {
  if (!objectIds || !objectIds.length) return [];
  const ids = objectIds.map((id) => `'${esc(String(id))}'`).join(',');
  const q = `
    SELECT
      toDate(timestamp) AS day,
      count() AS purchases,
      sum(revenue) AS revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_purchase'
      AND toDate(timestamp) >= toDate('${esc(startDate)}')
      AND toDate(timestamp) <= toDate('${esc(endDate)}')
      AND object_id IN (${ids})
    GROUP BY day
    ORDER BY day ASC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Individual click events for timeline (from link_clicks).
 */
exports.queryClickEventsForLinkIds = async function (linkIds, startTs, endTs, limit = 50, offset = 0) {
  if (!linkIds || !linkIds.length) return [];
  const ids = linkIds.map((id) => `'${esc(String(id))}'`).join(',');
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
  if (!linkIds || !linkIds.length) return 0;
  const ids = linkIds.map((id) => `'${esc(String(id))}'`).join(',');
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
 * Simple query: attribution events only (no clicks). Used by service layer for stitching.
 */
exports.queryAttributionEventsForTimeline = async function (objectIds, startDate, endDate) {
  if (!objectIds || !objectIds.length) return [];
  const ids = objectIds.map((id) => `'${esc(String(id))}'`).join(',');
  const q = `
    SELECT
      timestamp,
      event_name,
      revenue,
      ifNull(properties['plan_id'], '') AS plan_id,
      ifNull(properties['plan_name'], '') AS plan_name,
      ifNull(properties['channel'], '') AS channel,
      ifNull(properties['source_name'], '') AS source_name,
      device_id,
      user_id
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND toDate(timestamp) >= toDate('${esc(startDate)}')
      AND toDate(timestamp) <= toDate('${esc(endDate)}')
      AND object_id IN (${ids})
    ORDER BY timestamp DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Simple query: count attribution events only.
 */
exports.queryAttributionEventsCountForTimeline = async function (objectIds, startDate, endDate) {
  if (!objectIds || !objectIds.length) return 0;
  const ids = objectIds.map((id) => `'${esc(String(id))}'`).join(',');
  const q = `
    SELECT count() AS total
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND toDate(timestamp) >= toDate('${esc(startDate)}')
      AND toDate(timestamp) <= toDate('${esc(endDate)}')
      AND object_id IN (${ids})
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  const row = result.data && result.data[0];
  return row ? Number(row.total) : 0;
};

/**
 * Simple query: click events only. Used by service layer for stitching.
 */
exports.queryClickEventsForTimeline = async function (linkIds, startTs, endTs) {
  if (!linkIds || !linkIds.length) return [];
  const ids = linkIds.map((id) => `'${esc(String(id))}'`).join(',');
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
 * Simple query: count click events only.
 */
exports.queryClickEventsCountForTimeline = async function (linkIds, startTs, endTs) {
  if (!linkIds || !linkIds.length) return 0;
  const ids = linkIds.map((id) => `'${esc(String(id))}'`).join(',');
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

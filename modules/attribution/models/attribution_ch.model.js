'use strict';

const { slaveClickhouse } = require('../../../config/lib/clickhouse');

function esc(str) {
  return String(str).replace(/'/g, "''");
}

/** Resolved OS family from properties.install_os or os_name (matches queryInstallsByOs logic). */
function osFamilyExpr() {
  return `multiIf(
    ifNull(properties['install_os'], '') != '', lower(ifNull(properties['install_os'], '')),
    lower(ifNull(os_name, '')) LIKE '%ios%' OR lower(ifNull(os_name, '')) LIKE '%iphone%', 'ios',
    lower(ifNull(os_name, '')) LIKE '%android%', 'android',
    'other'
  )`;
}

/** When device_os is ios|android, filter raw attribution events. */
function osFilterClause(osFilter) {
  if (!osFilter || String(osFilter).toLowerCase() === 'all') return '';
  const o = String(osFilter).toLowerCase();
  if (o !== 'ios' && o !== 'android') return '';
  return ` AND (${osFamilyExpr()}) = '${esc(o)}' `;
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
exports.queryInstallsByDay = async function (startDate, endDate, osFilter) {
  const os = osFilterClause(osFilter);
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
      ${os}
    GROUP BY day, channel
    ORDER BY day ASC, channel ASC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Installs in range grouped by OS family (ios / android / other) using os_name + properties.install_os.
 */
exports.queryInstallsByOs = async function (startDate, endDate, osFilter) {
  const os = osFilterClause(osFilter);
  const q = `
    SELECT
      multiIf(
        ifNull(properties['install_os'], '') != '', lower(ifNull(properties['install_os'], '')),
        lower(ifNull(os_name, '')) LIKE '%ios%' OR lower(ifNull(os_name, '')) LIKE '%iphone%', 'ios',
        lower(ifNull(os_name, '')) LIKE '%android%', 'android',
        'other'
      ) AS os_family,
      count() AS installs
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_install'
      AND toDate(timestamp) >= toDate('${esc(startDate)}')
      AND toDate(timestamp) <= toDate('${esc(endDate)}')
      ${os}
    GROUP BY os_family
    ORDER BY installs DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Same shape as attribution_daily_stats / queryAttributionByChannel but from raw events (supports device_os filter).
 */
exports.queryAttributionByChannelFromRaw = async function (startDate, endDate, osFilter) {
  const os = osFilterClause(osFilter);
  const q = `
    SELECT
      event_name,
      ifNull(properties['channel'], '') AS channel,
      ifNull(properties['source_name'], '') AS source_name,
      count() AS total_events,
      sum(revenue) AS total_revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND toDate(timestamp) >= toDate('${esc(startDate)}')
      AND toDate(timestamp) <= toDate('${esc(endDate)}')
      ${os}
    GROUP BY event_name, channel, source_name
    ORDER BY total_events DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Funnel counts per OS family (install, signup, add_to_cart, purchase) for dashboards.
 */
exports.queryFunnelMetricsByOs = async function (startDate, endDate) {
  const q = `
    SELECT
      ${osFamilyExpr()} AS os_family,
      event_name,
      count() AS cnt,
      sum(revenue) AS total_revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name IN (
        'attributed_install',
        'attributed_signup',
        'attributed_add_to_cart',
        'attributed_purchase'
      )
      AND toDate(timestamp) >= toDate('${esc(startDate)}')
      AND toDate(timestamp) <= toDate('${esc(endDate)}')
    GROUP BY os_family, event_name
    ORDER BY os_family, event_name
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Funnel counts per OS for specific tracking link object_ids (same shape as queryFunnelMetricsByOs).
 */
exports.queryFunnelMetricsByOsForObjectIds = async function (objectIds, startDate, endDate) {
  if (!objectIds || !objectIds.length) return [];
  const ids = objectIds.map((id) => `'${esc(String(id))}'`).join(',');
  const q = `
    SELECT
      ${osFamilyExpr()} AS os_family,
      event_name,
      count() AS cnt,
      sum(revenue) AS total_revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name IN (
        'attributed_install',
        'attributed_signup',
        'attributed_add_to_cart',
        'attributed_purchase'
      )
      AND toDate(timestamp) >= toDate('${esc(startDate)}')
      AND toDate(timestamp) <= toDate('${esc(endDate)}')
      AND object_id IN (${ids})
    GROUP BY os_family, event_name
    ORDER BY os_family, event_name
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Installs grouped by OS family for specific tracking link object_ids.
 */
exports.queryInstallsByOsForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
  if (!objectIds || !objectIds.length) return [];
  const ids = objectIds.map((id) => `'${esc(String(id))}'`).join(',');
  const os = osFilterClause(osFilter);
  const q = `
    SELECT
      multiIf(
        ifNull(properties['install_os'], '') != '', lower(ifNull(properties['install_os'], '')),
        lower(ifNull(os_name, '')) LIKE '%ios%' OR lower(ifNull(os_name, '')) LIKE '%iphone%', 'ios',
        lower(ifNull(os_name, '')) LIKE '%android%', 'android',
        'other'
      ) AS os_family,
      count() AS installs
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_install'
      AND toDate(timestamp) >= toDate('${esc(startDate)}')
      AND toDate(timestamp) <= toDate('${esc(endDate)}')
      AND object_id IN (${ids})
      ${os}
    GROUP BY os_family
    ORDER BY installs DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Attribution events aggregated by channel for specific object_ids (same shape as queryAttributionByChannelFromRaw rows).
 */
exports.queryAttributionByChannelFromRawForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
  if (!objectIds || !objectIds.length) return [];
  const ids = objectIds.map((id) => `'${esc(String(id))}'`).join(',');
  const os = osFilterClause(osFilter);
  const q = `
    SELECT
      event_name,
      ifNull(properties['channel'], '') AS channel,
      ifNull(properties['source_name'], '') AS source_name,
      count() AS total_events,
      sum(revenue) AS total_revenue
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND toDate(timestamp) >= toDate('${esc(startDate)}')
      AND toDate(timestamp) <= toDate('${esc(endDate)}')
      AND object_id IN (${ids})
      ${os}
    GROUP BY event_name, channel, source_name
    ORDER BY total_events DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Clicks per channel for specific link_ids (for Performance by channel on profile/link stats).
 */
exports.queryClicksByChannelForLinkIds = async function (linkIds, startTs, endTs) {
  if (!linkIds || !linkIds.length) return [];
  const ids = linkIds.map((id) => `'${esc(String(id))}'`).join(',');
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
 * Signups in range grouped by auth_attribution_occasion (signup | login | unknown).
 */
exports.querySignupsByAuthOccasion = async function (startDate, endDate, osFilter) {
  const os = osFilterClause(osFilter);
  const q = `
    SELECT
      if(
        ifNull(properties['auth_attribution_occasion'], '') = '',
        'unknown',
        ifNull(properties['auth_attribution_occasion'], 'unknown')
      ) AS auth_occasion,
      count() AS signups
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_signup'
      AND toDate(timestamp) >= toDate('${esc(startDate)}')
      AND toDate(timestamp) <= toDate('${esc(endDate)}')
      ${os}
    GROUP BY auth_occasion
    ORDER BY signups DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Signups grouped by auth_attribution_occasion, scoped to tracking link object_id(s).
 */
exports.querySignupsByAuthOccasionForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
  if (!objectIds || !objectIds.length) return [];
  const ids = objectIds.map((id) => `'${esc(String(id))}'`).join(',');
  const os = osFilterClause(osFilter);
  const q = `
    SELECT
      if(
        ifNull(properties['auth_attribution_occasion'], '') = '',
        'unknown',
        ifNull(properties['auth_attribution_occasion'], 'unknown')
      ) AS auth_occasion,
      count() AS signups
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_signup'
      AND toDate(timestamp) >= toDate('${esc(startDate)}')
      AND toDate(timestamp) <= toDate('${esc(endDate)}')
      AND object_id IN (${ids})
      ${os}
    GROUP BY auth_occasion
    ORDER BY signups DESC
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
exports.queryAttributionEventsForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
  if (!objectIds || !objectIds.length) return [];
  const ids = objectIds.map((id) => `'${esc(String(id))}'`).join(',');
  const os = osFilterClause(osFilter);
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
      ${os}
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
exports.queryAttributionEventsByPlanForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
  if (!objectIds || !objectIds.length) return [];
  const ids = objectIds.map((id) => `'${esc(String(id))}'`).join(',');
  const os = osFilterClause(osFilter);
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
      ${os}
    GROUP BY event_name, plan_id, plan_name
    ORDER BY event_name ASC, cnt DESC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Daily installs for chart (object_id = tracking link id).
 */
exports.queryInstallsByDayForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
  if (!objectIds || !objectIds.length) return [];
  const ids = objectIds.map((id) => `'${esc(String(id))}'`).join(',');
  const os = osFilterClause(osFilter);
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
      ${os}
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
exports.queryPurchasesByDayForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
  if (!objectIds || !objectIds.length) return [];
  const ids = objectIds.map((id) => `'${esc(String(id))}'`).join(',');
  const os = osFilterClause(osFilter);
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
      ${os}
    GROUP BY day
    ORDER BY day ASC
  `;
  const result = await slaveClickhouse.querying(q, { dataObjects: true });
  return result.data || [];
};

/**
 * Repeat-purchase metrics (optional link scope via objectIds).
 * - repeat_buyers_distinct_users: distinct users with 2+ attributed_purchase rows in range.
 * - purchase_events_tagged_*: uses properties.purchase_ordinal (API v2); legacy rows have ordinal 0 in counts.
 */
async function queryPurchaseRepeatSummaryInner(objectIds, startDate, endDate, osFilter) {
  const os = osFilterClause(osFilter);
  const idClause =
    objectIds && objectIds.length
      ? `AND object_id IN (${objectIds.map((id) => `'${esc(String(id))}'`).join(',')})`
      : '';

  const qRepeat = `
    SELECT uniqExact(user_id) AS repeat_buyers_distinct_users
    FROM (
      SELECT user_id
      FROM analytics_events_raw
      WHERE object_type = 'attribution'
        AND event_name = 'attributed_purchase'
        AND toDate(timestamp) >= toDate('${esc(startDate)}')
        AND toDate(timestamp) <= toDate('${esc(endDate)}')
        AND ifNull(user_id, '') != ''
        ${idClause}
        ${os}
      GROUP BY user_id
      HAVING count() >= 2
    )
  `;
  const qTotals = `
    SELECT
      count() AS purchase_events_total,
      countIf(toUInt32OrZero(ifNull(properties['purchase_ordinal'], '0')) = 1) AS purchase_events_tagged_first,
      countIf(toUInt32OrZero(ifNull(properties['purchase_ordinal'], '0')) >= 2) AS purchase_events_tagged_repeat
    FROM analytics_events_raw
    WHERE object_type = 'attribution'
      AND event_name = 'attributed_purchase'
      AND toDate(timestamp) >= toDate('${esc(startDate)}')
      AND toDate(timestamp) <= toDate('${esc(endDate)}')
      ${idClause}
      ${os}
  `;
  const [repeatRes, totalsRes] = await Promise.all([
    slaveClickhouse.querying(qRepeat, { dataObjects: true }),
    slaveClickhouse.querying(qTotals, { dataObjects: true })
  ]);
  const r0 = repeatRes.data && repeatRes.data[0];
  const t0 = totalsRes.data && totalsRes.data[0];
  return {
    repeat_buyers_distinct_users: Number(r0 && r0.repeat_buyers_distinct_users) || 0,
    purchase_events_total: Number(t0 && t0.purchase_events_total) || 0,
    purchase_events_tagged_first: Number(t0 && t0.purchase_events_tagged_first) || 0,
    purchase_events_tagged_repeat: Number(t0 && t0.purchase_events_tagged_repeat) || 0
  };
}

exports.queryPurchaseRepeatSummaryForObjectIds = async function (objectIds, startDate, endDate, osFilter) {
  if (!objectIds || !objectIds.length) {
    return {
      repeat_buyers_distinct_users: 0,
      purchase_events_total: 0,
      purchase_events_tagged_first: 0,
      purchase_events_tagged_repeat: 0
    };
  }
  return queryPurchaseRepeatSummaryInner(objectIds, startDate, endDate, osFilter);
};

/** Platform-wide repeat purchase metrics (all tracking links). */
exports.queryPurchaseRepeatSummaryGlobal = async function (startDate, endDate, osFilter) {
  return queryPurchaseRepeatSummaryInner(null, startDate, endDate, osFilter);
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
      ifNull(properties['auth_attribution_occasion'], '') AS auth_attribution_occasion,
      ifNull(properties['purchase_ordinal'], '') AS purchase_ordinal,
      ifNull(properties['is_first_attributed_purchase'], '') AS is_first_attributed_purchase,
      ifNull(properties['app_user_id'], '') AS app_user_id_prop,
      ifNull(os_name, '') AS os_name,
      ifNull(properties['install_os'], '') AS install_os,
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

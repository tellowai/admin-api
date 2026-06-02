'use strict';

const { slaveClickhouse } = require('../../../config/lib/clickhouse');
const ANALYTICS_CONSTANTS = require('../constants/analytics.constants');

class AnalyticsModel {
  // Simple query methods - models are lean and dumb
  static async queryRawTable(tableName, whereConditions) {
    const query = `
      SELECT 
        toDate(generated_at) as date,
        count(*) as count
      FROM ${tableName}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY toDate(generated_at)
      ORDER BY date ASC
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryRawTableGrouped(tableName, whereConditions, groupByColumn) {
    const query = `
      SELECT 
        toDate(generated_at) as date,
        ${groupByColumn} as group_key,
        count(*) as count
      FROM ${tableName}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY toDate(generated_at), ${groupByColumn}
      ORDER BY date ASC, group_key ASC
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryHourlyTable(tableName, whereConditions) {
    const query = `
      SELECT 
        day as date,
        sum(events_count) as count
      FROM ${tableName}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY day
      ORDER BY date ASC
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryHourlyTableGrouped(tableName, whereConditions, groupByColumn) {
    const query = `
      SELECT 
        day as date,
        ${groupByColumn} as group_key,
        sum(events_count) as count
      FROM ${tableName}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY day, ${groupByColumn}
      ORDER BY date ASC, group_key ASC
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryDailyTable(tableName, whereConditions) {
    const query = `
      SELECT 
        day as date,
        sum(events_count) as count
      FROM ${tableName}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY day
      ORDER BY date ASC
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryDailyTableGrouped(tableName, whereConditions, groupByColumn) {
    const query = `
      SELECT 
        day as date,
        ${groupByColumn} as group_key,
        sum(events_count) as count
      FROM ${tableName}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY day, ${groupByColumn}
      ORDER BY date ASC, group_key ASC
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryMonthlyTable(tableName, whereConditions) {
    const query = `
      SELECT 
        month as date,
        sum(events_count) as count
      FROM ${tableName}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY month
      ORDER BY date ASC
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryMonthlyTableGrouped(tableName, whereConditions, groupByColumn) {
    const query = `
      SELECT 
        month as date,
        ${groupByColumn} as group_key,
        sum(events_count) as count
      FROM ${tableName}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY month, ${groupByColumn}
      ORDER BY date ASC, group_key ASC
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryCountRawTable(tableName, whereConditions) {
    const query = `
      SELECT COUNT(*) as total_count
      FROM ${tableName}
      WHERE ${whereConditions.join(' AND ')}
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0]?.total_count || 0;
  }

  static async queryCountSummaryTable(tableName, whereConditions) {
    const query = `
      SELECT sum(events_count) as total_count
      FROM ${tableName}
      WHERE ${whereConditions.join(' AND ')}
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0]?.total_count || 0;
  }

  // --- Materialized view tables (auth_daily_stats, revenue_daily_stats, template_daily_stats) ---
  // These use report_date and domain-specific measure columns.

  static async queryAuthDailyStats(whereConditions) {
    const query = `
      SELECT
        report_date as date,
        sum(total_events) as count
      FROM ${ANALYTICS_CONSTANTS.TABLES.AUTH_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY report_date
      ORDER BY date ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryAuthDailyStatsGrouped(whereConditions, groupByColumn) {
    const query = `
      SELECT
        report_date as date,
        ${groupByColumn} as group_key,
        sum(total_events) as count
      FROM ${ANALYTICS_CONSTANTS.TABLES.AUTH_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY report_date, ${groupByColumn}
      ORDER BY date ASC, group_key ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async getCountAuthDailyStats(whereConditions) {
    const query = `
      SELECT sum(total_events) as total_count
      FROM ${ANALYTICS_CONSTANTS.TABLES.AUTH_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0]?.total_count || 0;
  }

  static async queryRevenueDailyStats(whereConditions) {
    const query = `
      SELECT
        report_date as date,
        sum(total_purchases) as count
      FROM ${ANALYTICS_CONSTANTS.TABLES.REVENUE_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY report_date
      ORDER BY date ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryRevenueDailyStatsGrouped(whereConditions, groupByColumn) {
    const query = `
      SELECT
        report_date as date,
        ${groupByColumn} as group_key,
        sum(total_purchases) as count
      FROM ${ANALYTICS_CONSTANTS.TABLES.REVENUE_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY report_date, ${groupByColumn}
      ORDER BY date ASC, group_key ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /** Commerce purchase counts by client-local calendar day (`revenue_mv` semantics on raw). */
  static async queryPurchasesCommerceDailyClientTz(whereClause, clientTz) {
    const tzEsc = String(clientTz || 'UTC').replace(/'/g, "''");
    const query = `
      SELECT
        toString(toDate(toTimeZone(timestamp, '${tzEsc}'))) AS date,
        count() AS count
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      WHERE ${whereClause}
      GROUP BY date
      ORDER BY date ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /** Commerce purchases grouped by dimension, bucketed in client TZ. */
  static async queryPurchasesCommerceDailyGroupedClientTz(whereClause, groupKeyExpr, clientTz) {
    const tzEsc = String(clientTz || 'UTC').replace(/'/g, "''");
    const query = `
      SELECT
        toString(toDate(toTimeZone(timestamp, '${tzEsc}'))) AS date,
        ${groupKeyExpr} AS group_key,
        count() AS count
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      WHERE ${whereClause}
      GROUP BY date, group_key
      ORDER BY date ASC, group_key ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryPurchasesCommerceCountRaw(whereClause) {
    const query = `
      SELECT count() AS total_count
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      WHERE ${whereClause}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return Number(result.data?.[0]?.total_count) || 0;
  }

  /** Daily revenue (`sum(revenue)`) in client TZ — `revenue_mv` semantics on raw. */
  static async queryRevenueCommerceDailyClientTz(whereClause, clientTz) {
    const tzEsc = String(clientTz || 'UTC').replace(/'/g, "''");
    const query = `
      SELECT
        toString(toDate(toTimeZone(timestamp, '${tzEsc}'))) AS date,
        sum(ifNull(revenue, 0)) AS amount
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      WHERE ${whereClause}
      GROUP BY date
      ORDER BY date ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryRevenueCommerceDailyGroupedClientTz(whereClause, groupKeyExpr, clientTz) {
    const tzEsc = String(clientTz || 'UTC').replace(/'/g, "''");
    const query = `
      SELECT
        toString(toDate(toTimeZone(timestamp, '${tzEsc}'))) AS date,
        ${groupKeyExpr} AS group_key,
        sum(ifNull(revenue, 0)) AS amount
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      WHERE ${whereClause}
      GROUP BY date, group_key
      ORDER BY date ASC, group_key ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryRevenueCommerceSumRaw(whereClause) {
    const query = `
      SELECT sum(ifNull(revenue, 0)) AS total_amount
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      WHERE ${whereClause}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    const n = Number(result.data?.[0]?.total_amount);
    return Number.isFinite(n) ? n : 0;
  }

  static async queryRevenueTotalStats(whereConditions) {
    const query = `
      SELECT
        report_date as date,
        sum(total_revenue) as amount
      FROM ${ANALYTICS_CONSTANTS.TABLES.REVENUE_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY report_date
      ORDER BY date ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryRevenueTotalStatsGrouped(whereConditions, groupByColumn) {
    const query = `
      SELECT
        report_date as date,
        ${groupByColumn} as group_key,
        sum(total_revenue) as amount
      FROM ${ANALYTICS_CONSTANTS.TABLES.REVENUE_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY report_date, ${groupByColumn}
      ORDER BY date ASC, group_key ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async getCountRevenueDailyStats(whereConditions) {
    const query = `
      SELECT sum(total_purchases) as total_count
      FROM ${ANALYTICS_CONSTANTS.TABLES.REVENUE_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0]?.total_count || 0;
  }

  static async getSumRevenueDailyStats(whereConditions) {
    const query = `
      SELECT sum(total_revenue) as total_amount
      FROM ${ANALYTICS_CONSTANTS.TABLES.REVENUE_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0]?.total_amount || 0;
  }

  static async getCountAuthDailyStats(whereConditions) {
    const query = `
      SELECT sum(total_events) as total_count
      FROM ${ANALYTICS_CONSTANTS.TABLES.AUTH_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0]?.total_count || 0;
  }

  static async queryTemplateDailyStats(whereConditions, measureColumn) {
    const query = `
      SELECT
        report_date as date,
        sum(${measureColumn}) as count
      FROM ${ANALYTICS_CONSTANTS.TABLES.TEMPLATE_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY report_date
      ORDER BY date ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryTemplateDailyStatsGrouped(whereConditions, measureColumn, groupByColumn) {
    const query = `
      SELECT
        report_date as date,
        ${groupByColumn} as group_key,
        sum(${measureColumn}) as count
      FROM ${ANALYTICS_CONSTANTS.TABLES.TEMPLATE_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY report_date, ${groupByColumn}
      ORDER BY date ASC, group_key ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async getCountTemplateDailyStats(whereConditions, measureColumn) {
    const query = `
      SELECT sum(${measureColumn}) as total_count
      FROM ${ANALYTICS_CONSTANTS.TABLES.TEMPLATE_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0]?.total_count || 0;
  }

  // --- Credits daily stats (issued, reserved, deducted, released, users) ---
  static async queryCreditsDailyStats(whereConditions) {
    const query = `
      SELECT
        report_date AS date,
        sum(issued) AS issued,
        sum(reserved) AS reserved,
        sum(deducted) AS deducted,
        sum(released) AS released,
        uniqMerge(users_receiving) AS users_receiving_count,
        uniqMerge(users_spending) AS users_spending_count
      FROM ${ANALYTICS_CONSTANTS.TABLES.CREDITS_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY report_date
      ORDER BY date ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryCreditsDailyStatsGrouped(whereConditions, groupByColumn) {
    const query = `
      SELECT
        report_date AS date,
        ${groupByColumn} AS group_key,
        sum(issued) AS issued,
        sum(deducted) AS deducted,
        uniqMerge(users_receiving) AS users_receiving_count,
        uniqMerge(users_spending) AS users_spending_count
      FROM ${ANALYTICS_CONSTANTS.TABLES.CREDITS_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY report_date, ${groupByColumn}
      ORDER BY date ASC, group_key ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async getCreditsSummary(whereConditions) {
    const query = `
      SELECT
        sum(issued) AS total_issued,
        sum(deducted) AS total_deducted,
        (sum(issued) - sum(deducted)) AS system_balance_outstanding,
        uniqMerge(users_receiving) AS users_receiving_count,
        uniqMerge(users_spending) AS users_spending_count
      FROM ${ANALYTICS_CONSTANTS.TABLES.CREDITS_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0] || null;
  }

  /** All-time totals: single table sum, no date filter, no joins. Optional reason/country only. */
  static async getCreditsSummaryAllTime(whereConditions = []) {
    const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')} ` : '';
    const query = `
      SELECT
        sum(issued) AS total_issued,
        sum(deducted) AS total_deducted,
        (sum(issued) - sum(deducted)) AS system_balance_outstanding
      FROM ${ANALYTICS_CONSTANTS.TABLES.CREDITS_DAILY_STATS}
      ${whereClause}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0] || null;
  }

  /**
   * Stuck credit jobs: one row per (user_id, object_id) with reserved_ts and optional deducted_ts/released_ts.
   * - event_name filter limits scan to lifecycle events (matches MergeTree ORDER BY event_name).
   * - countIf ensures NULL when no event (avoids epoch sentinel from minIf/maxIf).
   */
  static async queryCreditsStuckJobsFromRaw(timestampConditions) {
    const query = `
      SELECT
        user_id,
        object_id,
        maxIf(timestamp, event_name = 'credit_reserved') AS reserved_ts,
        if (countIf(event_name = 'credit_deducted') > 0, minIf(timestamp, event_name = 'credit_deducted'), NULL) AS deducted_ts,
        if (countIf(event_name = 'credit_released') > 0, minIf(timestamp, event_name = 'credit_released'), NULL) AS released_ts
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      WHERE object_type = 'credit'
        AND event_name IN('credit_reserved', 'credit_deducted', 'credit_released')
        AND ${timestampConditions.join(' AND ')}
      GROUP BY user_id, object_id
      HAVING reserved_ts IS NOT NULL
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /**
   * Top templates by generation outcomes (tries + successes in date range).
   * Ordered by successes, then tries. Paginated via LIMIT/OFFSET for scale.
   */
  static async getTopTemplatesByGeneration(whereConditions, limit, offset) {
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
    const tries = ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.TRIES;
    const successes = ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.SUCCESSES;
    const query = `
      SELECT
        template_id,
        sum(${tries}) as tries,
        sum(${successes}) as successes
      FROM ${ANALYTICS_CONSTANTS.TABLES.TEMPLATE_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY template_id
      HAVING successes > 0 OR tries > 0
      ORDER BY successes DESC, tries DESC
      LIMIT ${safeLimit}
      OFFSET ${safeOffset}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  // --- AI execution daily stats (SummingMergeTree: use FINAL so merged rows with summed totals are returned) ---
  static async queryAIExecutionSummary(whereConditions) {
    const query = `
      SELECT
        status,
        total_executions AS total_runs,
        total_duration_ms,
        total_queue_ms,
        total_cost
      FROM ${ANALYTICS_CONSTANTS.TABLES.AI_EXECUTION_DAILY_STATS} FINAL
      WHERE ${whereConditions.join(' AND ')}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryAIExecutionByModel(whereConditions) {
    const query = `
      SELECT
        model_name,
        provider_name,
        status,
        total_executions AS total_runs,
        total_duration_ms,
        total_queue_ms,
        total_cost
      FROM ${ANALYTICS_CONSTANTS.TABLES.AI_EXECUTION_DAILY_STATS} FINAL
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY model_name ASC, provider_name ASC, status ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryAIExecutionByDay(whereConditions) {
    const query = `
      SELECT
        report_date AS date,
        model_name,
        status,
        total_executions AS total_runs,
        total_duration_ms
      FROM ${ANALYTICS_CONSTANTS.TABLES.AI_EXECUTION_DAILY_STATS} FINAL
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY report_date DESC, model_name ASC, status ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryAIExecutionCostByTemplate(whereConditions) {
    const query = `
SELECT
template_id,
  total_executions AS total_calls,
    total_cost AS total_cost_usd
      FROM ${ANALYTICS_CONSTANTS.TABLES.AI_EXECUTION_DAILY_STATS} FINAL
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY template_id ASC
  `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryAIExecutionCostByDay(whereConditions) {
    const query = `
SELECT
        report_date AS date,
  provider_name,
  total_cost
      FROM ${ANALYTICS_CONSTANTS.TABLES.AI_EXECUTION_DAILY_STATS} FINAL
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY report_date ASC, provider_name ASC
  `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryAIExecutionByErrorCategory(whereConditions) {
    const query = `
SELECT
error_category,
  status,
  total_executions AS total_runs
      FROM ${ANALYTICS_CONSTANTS.TABLES.AI_EXECUTION_DAILY_STATS} FINAL
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY error_category ASC, status ASC
  `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  // --- AE rendering daily stats (SummingMergeTree: use FINAL for merged rows) ---
  static async queryAERenderingSummary(whereConditions) {
    const query = `
      SELECT
        status,
        total_jobs,
        total_job_time_ms,
        total_validation_ms,
        total_asset_download_ms,
        total_template_download_ms,
        total_user_assets_download_ms,
        total_composition_ms,
        total_bundling_ms,
        total_rendering_ms,
        total_upload_ms
      FROM ${ANALYTICS_CONSTANTS.TABLES.AE_RENDERING_DAILY_STATS} FINAL
      WHERE ${whereConditions.join(' AND ')}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryAERenderingByVersion(whereConditions) {
    const query = `
      SELECT
        ae_version,
        status,
        total_jobs,
        total_job_time_ms,
        total_rendering_ms,
        total_upload_ms
      FROM ${ANALYTICS_CONSTANTS.TABLES.AE_RENDERING_DAILY_STATS} FINAL
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY ae_version ASC, status ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryAERenderingByDay(whereConditions) {
    const query = `
      SELECT
        report_date AS date,
        ae_version,
        total_jobs,
        total_job_time_ms
      FROM ${ANALYTICS_CONSTANTS.TABLES.AE_RENDERING_DAILY_STATS} FINAL
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY report_date DESC, ae_version ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryAERenderingByDayWithStatus(whereConditions) {
    const query = `
      SELECT
        report_date AS date,
        status,
        total_jobs
      FROM ${ANALYTICS_CONSTANTS.TABLES.AE_RENDERING_DAILY_STATS} FINAL
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY report_date ASC, status ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryAERenderingStepsByDay(whereConditions) {
    const query = `
      SELECT
        report_date AS date,
        total_asset_download_ms,
        total_template_download_ms,
        total_upload_ms,
        total_composition_ms,
        total_bundling_ms,
        total_rendering_ms
      FROM ${ANALYTICS_CONSTANTS.TABLES.AE_RENDERING_DAILY_STATS} FINAL
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY report_date ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryAERenderingByErrorCategory(whereConditions) {
    const query = `
      SELECT
        error_category,
        status,
        total_jobs
      FROM ${ANALYTICS_CONSTANTS.TABLES.AE_RENDERING_DAILY_STATS} FINAL
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY error_category ASC, status ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  // --- Tech health daily stats (SummingMergeTree: aggregate with sum + uniqMerge) ---
  static async queryTechHealthVersionAdoption(whereConditions) {
    const query = `
      SELECT
        report_date AS date,
        app_version,
        uniqMerge(active_devices) AS active_devices,
        sum(total_events) AS total_events
      FROM ${ANALYTICS_CONSTANTS.TABLES.TECH_HEALTH_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY report_date, app_version
      ORDER BY report_date ASC, app_version ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryTechHealthErrorRateByVersion(whereConditions) {
    const query = `
      SELECT
        app_version,
        uniqMerge(active_devices) AS total_users,
        sum(total_events) AS total_actions,
        sum(failed_events) AS failed_events
      FROM ${ANALYTICS_CONSTANTS.TABLES.TECH_HEALTH_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY app_version
      ORDER BY app_version DESC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryTechHealthNetworkBottlenecks(whereConditions) {
    const query = `
      SELECT
        network_type,
        uniqMerge(active_devices) AS unique_devices,
        sum(total_events) AS total_events,
        sum(failed_events) AS failed_events
      FROM ${ANALYTICS_CONSTANTS.TABLES.TECH_HEALTH_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY network_type
      ORDER BY unique_devices DESC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryTechHealthOsDistribution(whereConditions) {
    const query = `
      SELECT
        os_name,
        os_version,
        uniqMerge(active_devices) AS devices,
        sum(total_events) AS total_events
      FROM ${ANALYTICS_CONSTANTS.TABLES.TECH_HEALTH_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY os_name, os_version
      ORDER BY total_events DESC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryTechHealthDevicePopularity(whereConditions, limit = 20) {
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 50);
    const query = `
      SELECT
        device_brand,
        device_model,
        uniqMerge(active_devices) AS devices,
        sum(total_events) AS total_events
      FROM ${ANALYTICS_CONSTANTS.TABLES.TECH_HEALTH_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY device_brand, device_model
      ORDER BY total_events DESC
      LIMIT ${safeLimit}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryTechHealthDeviceBrandDistribution(whereConditions, limit = 20) {
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 50);
    const query = `
      SELECT
        device_brand,
        uniqMerge(active_devices) AS devices,
        sum(total_events) AS total_events
      FROM ${ANALYTICS_CONSTANTS.TABLES.TECH_HEALTH_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')} AND device_brand != ''
      GROUP BY device_brand
      ORDER BY total_events DESC
      LIMIT ${safeLimit}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryTechHealthScreenResolution(whereConditions, limit = 30) {
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 30), 50);
    const query = `
      SELECT
        screen_resolution,
        uniqMerge(active_devices) AS devices,
        sum(total_events) AS total_events
      FROM ${ANALYTICS_CONSTANTS.TABLES.TECH_HEALTH_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')} AND screen_resolution != ''
      GROUP BY screen_resolution
      ORDER BY total_events DESC
      LIMIT ${safeLimit}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryTechHealthCountryDistribution(whereConditions) {
    const query = `
      SELECT
        country,
        uniqMerge(active_devices) AS devices,
        sum(total_events) AS total_events
      FROM ${ANALYTICS_CONSTANTS.TABLES.TECH_HEALTH_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')} AND country != ''
      GROUP BY country
      ORDER BY total_events DESC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryTechHealthUsageByTimezone(whereConditions, limit = 30) {
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 30), 50);
    const query = `
      SELECT
        timezone,
        sum(total_events) AS total_events,
        uniqMerge(active_devices) AS devices
      FROM ${ANALYTICS_CONSTANTS.TABLES.TECH_HEALTH_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')} AND timezone != ''
      GROUP BY timezone
      ORDER BY total_events DESC
      LIMIT ${safeLimit}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  // =============================================================================
  // Payment Failures Spoke (payment_failures_daily_stats)
  // Engine: SummingMergeTree → use sum() for SimpleAggregateFunction columns and
  // uniqMerge() for AggregateFunction(uniq, ...) columns.
  // Event discriminator `event_name` covers both server-side (order_failed) and
  // client-side (purchase_failed / purchase_cancelled) funnels.
  // =============================================================================

  /** Totals for the metric strip: failures, attempts (correlations), users, devices. */
  static async queryPaymentFailuresSummary(whereConditions) {
    const query = `
      SELECT
        sum(failure_count)               AS total_failures,
        uniqMerge(unique_users)          AS unique_users,
        uniqMerge(unique_devices)        AS unique_devices,
        uniqMerge(unique_correlations)   AS unique_attempts
      FROM ${ANALYTICS_CONSTANTS.TABLES.PAYMENT_FAILURES_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0] || null;
  }

  /** Daily series (used for line/stacked-area chart). */
  static async queryPaymentFailuresDaily(whereConditions) {
    const query = `
      SELECT
        report_date                    AS date,
        sum(failure_count)             AS count,
        uniqMerge(unique_correlations) AS unique_attempts
      FROM ${ANALYTICS_CONSTANTS.TABLES.PAYMENT_FAILURES_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY report_date
      ORDER BY date ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /** Daily series broken down by a LowCardinality dimension (stacked). */
  static async queryPaymentFailuresDailyGrouped(whereConditions, groupByColumn) {
    const query = `
      SELECT
        report_date        AS date,
        ${groupByColumn}   AS group_key,
        sum(failure_count) AS count
      FROM ${ANALYTICS_CONSTANTS.TABLES.PAYMENT_FAILURES_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY report_date, ${groupByColumn}
      ORDER BY date ASC, count DESC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /**
   * Same failure rows as `payment_failures_mv`, but bucket `date` in the **client**
   * IANA timezone — matches `queryOrdersFunnelClickhouseDaily` so the Payment Failures
   * combo chart aligns with "Orders Created" (MV `report_date` is UTC `toDate(timestamp)`).
   *
   * @param {string} whereClause  Full WHERE body (timestamp window + event predicate + filters)
   * @param {string} groupKeyExpr Safe SQL expression for GROUP BY (built server-side from allowlist)
   * @param {string} clientTz     IANA tz, escaped for SQL string literal
   */
  static async queryPaymentFailuresDailyGroupedClientTz(whereClause, groupKeyExpr, clientTz) {
    const tzEsc = String(clientTz || 'UTC').replace(/'/g, "''");
    const query = `
      SELECT
        toString(toDate(toTimeZone(timestamp, '${tzEsc}'))) AS date,
        ${groupKeyExpr} AS group_key,
        count() AS count
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      WHERE ${whereClause}
      GROUP BY date, group_key
      ORDER BY date ASC, count DESC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /**
   * Top-N breakdown by any allowed dimension. Used for bar/pie charts
   * (category, layer, gateway, error_code, product_classification, ...).
   */
  static async queryPaymentFailuresBreakdown(whereConditions, groupByColumn, limit = 20) {
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
    const query = `
      SELECT
        ${groupByColumn}               AS group_key,
        sum(failure_count)             AS count,
        uniqMerge(unique_users)        AS unique_users,
        uniqMerge(unique_correlations) AS unique_attempts
      FROM ${ANALYTICS_CONSTANTS.TABLES.PAYMENT_FAILURES_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY ${groupByColumn}
      ORDER BY count DESC
      LIMIT ${safeLimit}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /** Ungrouped daily counts in client TZ (same predicate as {@link queryPaymentFailuresDailyGroupedClientTz}). */
  static async queryPaymentFailuresDailyClientTz(whereClause, clientTz) {
    const tzEsc = String(clientTz || 'UTC').replace(/'/g, "''");
    const query = `
      SELECT
        toString(toDate(toTimeZone(timestamp, '${tzEsc}'))) AS date,
        count() AS count,
        uniq(properties['correlation_id']) AS unique_attempts
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      WHERE ${whereClause}
      GROUP BY date
      ORDER BY date ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /** Summary totals over raw failure rows in a UTC timestamp window (client calendar semantics). */
  static async queryPaymentFailuresSummaryRaw(whereClause) {
    const query = `
      SELECT
        count() AS total_failures,
        uniq(ifNull(user_id, '')) AS unique_users,
        uniq(ifNull(device_id, '')) AS unique_devices,
        uniq(properties['correlation_id']) AS unique_attempts
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      WHERE ${whereClause}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0] || null;
  }

  /** Top-N breakdown on raw rows (client-calendar window in {@code whereClause}). */
  static async queryPaymentFailuresBreakdownRaw(whereClause, groupKeyExpr, limit = 20) {
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
    const query = `
      SELECT
        ${groupKeyExpr} AS group_key,
        count() AS count,
        uniq(ifNull(user_id, '')) AS unique_users,
        uniq(properties['correlation_id']) AS unique_attempts
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      WHERE ${whereClause}
      GROUP BY group_key
      ORDER BY count DESC
      LIMIT ${safeLimit}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /** Two-dimensional breakdown on raw rows. */
  static async queryPaymentFailuresMatrixRaw(whereClause, rowKeyExpr, colKeyExpr, limit = 200) {
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 200), 500);
    const query = `
      SELECT
        ${rowKeyExpr} AS row_key,
        ${colKeyExpr} AS col_key,
        count() AS count
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      WHERE ${whereClause}
      GROUP BY row_key, col_key
      ORDER BY count DESC
      LIMIT ${safeLimit}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /**
   * Top recurring (error_code, error_message) groups straight out of
   * `analytics_events_raw`. Bypasses the MV because the MV deliberately
   * drops the high-cardinality `error_message` text — yet that text is
   * exactly what we need to author new regex rules in
   * `mobile-app/src/payments/utils/classifyPaymentError.ts` to pull events
   * out of the `failure_category='unknown'` bucket.
   *
   * Kept deliberately lean: only `count`, `uniq(user_id)`,
   * `uniq(correlation_id)` and `max(timestamp)`. No `anyHeavy(...)` —
   * that's a heavy-hitters approximation we were paying for without
   * surfacing the result anywhere in the UI. Anything else (sample
   * order_id, app_version, etc.) belongs in the per-event `samples`
   * query, which is a much cheaper "stitchable" follow-up keyed off the
   * same WHERE clause.
   *
   * Pagination is `LIMIT/OFFSET` so the UI can drive a load-more button
   * instead of pulling every group at once.
   *
   * @param {string} whereClause  Full WHERE body (AND-joined, no leading WHERE)
   */
  static async queryPaymentFailuresMessageGroups(whereClause, limit = 25, offset = 0) {
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 25), 200);
    const safeOffset = Math.min(Math.max(0, parseInt(offset, 10) || 0), 5000);
    const query = `
      SELECT
        event_name                                  AS event_name,
        properties['payment_gateway']               AS payment_gateway,
        properties['failure_category']              AS failure_category,
        properties['error_code']                    AS error_code,
        properties['response_code']                 AS response_code,
        properties['error_message']                 AS error_message,
        count()                                     AS count,
        uniq(ifNull(user_id, ''))                   AS unique_users,
        uniq(properties['correlation_id'])          AS unique_attempts,
        max(timestamp)                              AS last_seen
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      WHERE ${whereClause}
      GROUP BY
        event_name, payment_gateway, failure_category,
        error_code, response_code, error_message
      ORDER BY count DESC
      LIMIT ${safeLimit}
      OFFSET ${safeOffset}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /**
   * Per-event sample list from `analytics_events_raw`. Caller can paginate
   * via limit/offset. Returned rows mirror the MV's filterable dims plus
   * the raw text fields the MV drops, so the admin UI can show a "log
   * tail" of failures without blowing up cardinality on the spoke.
   *
   * @param {string} whereClause  Full WHERE body (AND-joined, no leading WHERE)
   */
  static async queryPaymentFailuresSamples(whereClause, limit = 50, offset = 0) {
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 200);
    const safeOffset = Math.min(Math.max(0, parseInt(offset, 10) || 0), 5000);
    const query = `
      SELECT
        timestamp                                   AS timestamp,
        event_name                                  AS event_name,
        ifNull(user_id, '')                         AS user_id,
        device_id                                   AS device_id,
        app_version                                 AS app_version,
        os_name                                     AS os_name,
        os_version                                  AS os_version,
        device_brand                                AS device_brand,
        device_model                                AS device_model,
        store_country                               AS store_country,
        country                                     AS ip_country,
        timezone                                    AS timezone,
        properties['payment_gateway']               AS payment_gateway,
        properties['failure_layer']                 AS failure_layer,
        properties['failure_category']              AS failure_category,
        properties['error_code']                    AS error_code,
        properties['response_code']                 AS response_code,
        properties['error_message']                 AS error_message,
        properties['retryable']                     AS retryable,
        properties['correlation_id']                AS correlation_id,
        properties['order_id']                      AS order_id,
        properties['product_id']                    AS product_id,
        properties['plan_id']                       AS plan_id,
        properties['plan_name']                     AS plan_name,
        properties['product_classification']        AS product_classification,
        properties['plan_type']                     AS plan_type,
        properties['billing_interval']              AS billing_interval,
        properties['currency']                      AS currency,
        properties['amount']                        AS amount,
        properties['quantity']                      AS quantity,
        properties['source_screen']                 AS source_screen,
        properties['template_id']                   AS template_id
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      WHERE ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ${safeLimit}
      OFFSET ${safeOffset}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /**
   * Two-dimensional breakdown (e.g. layer × category, gateway × error_code).
   * Good for heatmap tables showing where failures concentrate.
   */
  static async queryPaymentFailuresMatrix(whereConditions, rowColumn, columnColumn, limit = 200) {
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 200), 500);
    const query = `
      SELECT
        ${rowColumn}       AS row_key,
        ${columnColumn}    AS col_key,
        sum(failure_count) AS count
      FROM ${ANALYTICS_CONSTANTS.TABLES.PAYMENT_FAILURES_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY ${rowColumn}, ${columnColumn}
      ORDER BY count DESC
      LIMIT ${safeLimit}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /**
   * UTC timestamp predicates on analytics_events_raw.timestamp (DateTime64).
   * Matches the pattern used for payment-failure raw queries.
   */
  static buildRawUtcTimestampConditions(startDate, endDate) {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    const startStr = new Date(startMs).toISOString().slice(0, 19).replace('T', ' ');
    const endStr = new Date(endMs).toISOString().slice(0, 19).replace('T', ' ');
    return [
      `timestamp >= toDateTime64('${startStr}', 3, 'UTC')`,
      `timestamp <= toDateTime64('${endStr}.999', 3, 'UTC')`
    ];
  }

  /**
   * Sum template views in date range, grouped by template_id (hub: template_daily_stats).
   */
  static async getTemplateViewsSumByTemplateId(whereConditions) {
    const query = `
      SELECT
        template_id,
        sum(views) AS views
      FROM ${ANALYTICS_CONSTANTS.TABLES.TEMPLATE_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
        AND template_id != ''
      GROUP BY template_id
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /**
   * Per-template aggregates for template_daily_stats in date window, filtered to template_ids (batch).
   */
  static async getTemplatePerformanceAggregatesBatch(whereConditions, templateIds) {
    if (!templateIds || templateIds.length === 0) return [];
    const safeIds = templateIds
      .map((id) => `'${String(id).replace(/'/g, "''")}'`)
      .join(', ');
    const query = `
      SELECT
        template_id,
        sum(views) AS views,
        sum(tries) AS generations,
        sum(downloads) AS downloads,
        sum(successes) AS successes,
        sum(failures) AS failures
      FROM ${ANALYTICS_CONSTANTS.TABLES.TEMPLATE_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
        AND template_id IN (${safeIds})
      GROUP BY template_id
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /**
   * Completed orders with template attribution from analytics_events_raw.
   *
   * PREWHERE: event_name, object_type, timestamp — matches MergeTree ORDER BY.
   * WHERE: Map predicate only (fewer rows read from properties).
   */
  static async getOrderCompletedStatsByTemplateIdRaw(timestampConditions) {
    const ts = (timestampConditions || []).join(' AND ');
    const query = `
      SELECT
        properties['template_id'] AS template_id,
        upper(coalesce(nullIf(properties['currency'], ''), 'INR')) AS currency,
        count() AS purchases,
        sum(toFloat64OrZero(properties['amount'])) AS revenue
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      PREWHERE event_name = 'order_completed'
        AND object_type = 'order'
        AND ${ts}
      WHERE properties['template_id'] != ''
      GROUP BY properties['template_id'], currency
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /**
   * Same as getOrderCompletedStatsByTemplateIdRaw but scoped to template_ids (performance table merge).
   */
  static async getOrderCompletedStatsByTemplateIdsRaw(timestampConditions, templateIds) {
    if (!templateIds || templateIds.length === 0) return [];
    const ts = (timestampConditions || []).join(' AND ');
    const safeIds = templateIds
      .map((id) => `'${String(id).replace(/'/g, "''")}'`)
      .join(', ');
    const query = `
      SELECT
        properties['template_id'] AS template_id,
        upper(coalesce(nullIf(properties['currency'], ''), 'INR')) AS currency,
        count() AS purchases,
        sum(toFloat64OrZero(properties['amount'])) AS revenue
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      PREWHERE event_name = 'order_completed'
        AND object_type = 'order'
        AND ${ts}
      WHERE properties['template_id'] != ''
        AND properties['template_id'] IN (${safeIds})
      GROUP BY properties['template_id'], currency
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /**
   * order_created / order_completed events attributed to template_id (same date window as top-templates / performance).
   */
  static async getOrderCountsByTemplateIdsRaw(timestampConditions, templateIds) {
    if (!templateIds || templateIds.length === 0) return [];
    const ts = (timestampConditions || []).join(' AND ');
    const safeIds = templateIds
      .map((id) => `'${String(id).replace(/'/g, "''")}'`)
      .join(', ');
    const query = `
      SELECT
        properties['template_id'] AS template_id,
        countIf(event_name = 'order_created') AS orders_created,
        countIf(event_name = 'order_completed') AS orders_completed
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      PREWHERE event_name IN ('order_created', 'order_completed')
        AND object_type = 'order'
        AND ${ts}
      WHERE properties['template_id'] != ''
        AND properties['template_id'] IN (${safeIds})
      GROUP BY properties['template_id']
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryTechHealthStoreVsCountry(whereConditions, limit = 50) {
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 100);
    const query = `
      SELECT
        store_country,
        country,
        uniqMerge(active_devices) AS devices,
        sum(total_events) AS total_events
      FROM ${ANALYTICS_CONSTANTS.TABLES.TECH_HEALTH_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')} AND store_country != '' AND country != ''
      GROUP BY store_country, country
      ORDER BY total_events DESC
      LIMIT ${safeLimit}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /**
   * Per-calendar-day (client IANA tz) created vs completed from analytics_events_raw.
   * PREWHERE: event_name, object_type, timestamp, optional app_version — aligned with
   * MergeTree ORDER BY (event_name, object_type, timestamp). Map filters in WHERE.
   */
  static async queryOrdersFunnelClickhouseDaily(prewhereParts, whereParts, clientTz) {
    const pre = (prewhereParts && prewhereParts.length) ? prewhereParts.join(' AND ') : '1';
    const whereClauses = (whereParts && whereParts.length) ? whereParts.join(' AND ') : null;
    const whereSql = whereClauses != null && whereClauses.length ? `WHERE ${whereClauses}` : '';

    const tzRaw = String(clientTz || 'UTC').trim() || 'UTC';
    const tzEsc = tzRaw.replace(/'/g, "''");
    const query = `
      SELECT
        toString(toDate(toTimeZone(timestamp, '${tzEsc}'))) AS date,
        countIf(event_name = 'order_created') AS created_cnt,
        countIf(event_name = 'order_completed') AS completed_cnt
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      PREWHERE ${pre}
      ${whereSql}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryOrdersFunnelClickhouseSummary(prewhereParts, whereParts) {
    const pre = (prewhereParts && prewhereParts.length) ? prewhereParts.join(' AND ') : '1';
    const whereClauses = (whereParts && whereParts.length) ? whereParts.join(' AND ') : null;
    const whereSql = whereClauses != null && whereClauses.length ? `WHERE ${whereClauses}` : '';

    const query = `
      SELECT
        countIf(event_name = 'order_created') AS created_count,
        countIf(event_name = 'order_completed') AS completed_count,
        countIf(event_name = 'order_failed') AS failed_count
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      PREWHERE ${pre}
      ${whereSql}
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0] || null;
  }

  /**
   * One simple query on analytics_events_raw (no MySQL join): app/os from order lifecycle
   * events keyed by object_id = internal order_id.
   *
   * Sort key (max wins): (1) rows that have any non-empty app_version / os_name / os_version —
   * server-side `order_completed` often has empty client columns while `order_created` from
   * the app has headers; (2) event priority completed > created > failed; (3) latest timestamp.
   *
   * @param {Array<number|string>} orderIds
   * @returns {Promise<Map<string, { analytics_app_version: string|null, analytics_os_name: string|null, analytics_os_version: string|null }>>}
   */
  static async fetchOrderLifecycleDeviceContextByOrderIds(orderIds) {
    const out = new Map();
    const ids = [
      ...new Set(
        (orderIds || [])
          .map((id) => (id != null ? String(id).trim() : ''))
          .filter((s) => s !== '' && /^\d+$/.test(s))
      )
    ];
    if (!ids.length) return out;

    const esc = (s) => String(s).replace(/'/g, "''");
    const inList = ids.map((id) => `'${esc(id)}'`).join(', ');
    const table = ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW;

    const ctxRank = `(
            toUInt8(
              (trimBoth(coalesce(app_version, '')) != '')
              OR (trimBoth(coalesce(os_name, '')) != '')
              OR (trimBoth(coalesce(os_version, '')) != '')
            ),
            toUInt8(multiIf(event_name = 'order_completed', 2, event_name = 'order_created', 1, 0)),
            timestamp
          )`;

    const query = `
      SELECT
        object_id AS order_id,
        argMax(
          app_version,
          ${ctxRank}
        ) AS analytics_app_version,
        argMax(
          os_name,
          ${ctxRank}
        ) AS analytics_os_name,
        argMax(
          os_version,
          ${ctxRank}
        ) AS analytics_os_version
      FROM ${table}
      PREWHERE object_type = 'order'
        AND event_name IN ('order_created', 'order_completed', 'order_failed')
      WHERE object_id IN (${inList})
      GROUP BY object_id
    `;

    try {
      const result = await slaveClickhouse.querying(query, { dataObjects: true });
      const rows = result.data || [];
      for (const r of rows) {
        const key = r.order_id != null ? String(r.order_id) : '';
        if (!key) continue;
        const av =
          r.analytics_app_version != null && String(r.analytics_app_version).trim() !== ''
            ? String(r.analytics_app_version).trim()
            : null;
        const osn =
          r.analytics_os_name != null && String(r.analytics_os_name).trim() !== ''
            ? String(r.analytics_os_name).trim()
            : null;
        const osv =
          r.analytics_os_version != null && String(r.analytics_os_version).trim() !== ''
            ? String(r.analytics_os_version).trim()
            : null;
        out.set(key, {
          analytics_app_version: av,
          analytics_os_name: osn,
          analytics_os_version: osv
        });
      }
    } catch (e) {
      console.error('fetchOrderLifecycleDeviceContextByOrderIds:', e.message);
    }
    return out;
  }

  /**
   * Fused growth overview: one pass over `analytics_events_raw` for installs, template views,
   * commerce purchases, and order lifecycle in the UTC window. PREWHERE uses timestamp plus
   * a disjunction of (event_name, object_type) pairs — aligned with ORDER BY (event_name, object_type, timestamp).
   * Order-only filters (gateway, product_classification, app_version) are applied inside countIf/sumIf
   * so non-order rows are not dropped; app_version is also repeated on the order PREWHERE branch.
   */
  static async queryGrowthOverviewFused(rangeStartUtc, rangeEndUtc, clientTz, fragments) {
    const esc = (s) => String(s).replace(/'/g, "''");
    const startEsc = esc(rangeStartUtc);
    const endEsc = esc(rangeEndUtc);
    const tzRaw = String(clientTz || 'UTC').trim() || 'UTC';
    const tzEsc = tzRaw.replace(/'/g, "''");
    const table = ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW;
    const { orderPreAppFragment = '', orderAggFragment = '' } = fragments || {};

    const query = `
      SELECT
        toString(toDate(toTimeZone(timestamp, '${tzEsc}'))) AS date,
        countIf(event_name = 'template_view' AND object_type = 'template') AS views,
        countIf(event_name = 'attributed_install' AND object_type = 'attribution') AS installs,
        sumIf(revenue, event_name = 'purchase' AND object_type = 'commerce' AND revenue > 0) AS gross_revenue,
        countIf(event_name = 'purchase' AND object_type = 'commerce' AND revenue > 0) AS purchase_rows,
        uniqIf(user_id, event_name = 'purchase' AND object_type = 'commerce' AND revenue > 0 AND user_id IS NOT NULL AND trimBoth(user_id) != '') AS paying_users,
        countIf(event_name = 'order_created' AND object_type = 'order'${orderAggFragment}) AS orders_created,
        countIf(event_name = 'order_completed' AND object_type = 'order'${orderAggFragment}) AS orders_completed,
        sumIf(toFloat64OrZero(properties['amount']), event_name = 'order_completed' AND object_type = 'order'${orderAggFragment}) AS revenue_completed
      FROM ${table}
      PREWHERE timestamp >= toDateTime64('${startEsc}', 3, 'UTC')
        AND timestamp <= toDateTime64('${endEsc}', 3, 'UTC')
        AND (
          (event_name = 'template_view' AND object_type = 'template')
          OR (event_name = 'attributed_install' AND object_type = 'attribution')
          OR (event_name = 'purchase' AND object_type = 'commerce')
          OR (event_name IN ('order_created', 'order_completed') AND object_type = 'order'${orderPreAppFragment})
        )
      GROUP BY date
      ORDER BY date ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /**
   * Cloud infra cost spoke (from Hub MV). One row per provider per day after FINAL merge.
   */
  static async queryCloudInfraCostDailyByDateRange(startCal, endCal) {
    const esc = (s) => String(s).replace(/'/g, "''");
    const table = ANALYTICS_CONSTANTS.TABLES.CLOUD_INFRA_COST_DAILY_STATS;
    const query = `
      SELECT
        toString(report_date) AS cost_date,
        provider,
        currency,
        status,
        estimated_total_net,
        estimated_total_gross,
        resource_count,
        error_message
      FROM ${table} FINAL
      WHERE report_date >= toDate('${esc(startCal)}')
        AND report_date <= toDate('${esc(endCal)}')
      ORDER BY report_date ASC, provider ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /** Distinct users with any event per calendar day (infra unit economics denominator). */
  static async queryInfraCostDailyActiveUsers(rangeStartUtc, rangeEndUtc, clientTz) {
    const esc = (s) => String(s).replace(/'/g, "''");
    const tzEsc = (String(clientTz || 'UTC').trim() || 'UTC').replace(/'/g, "''");
    const table = ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW;
    const query = `
      SELECT
        toString(toDate(toTimeZone(timestamp, '${tzEsc}'))) AS date,
        uniqIf(user_id, user_id IS NOT NULL AND trimBoth(user_id) != '') AS active_users
      FROM ${table}
      PREWHERE timestamp >= toDateTime64('${esc(rangeStartUtc)}', 3, 'UTC')
        AND timestamp <= toDateTime64('${esc(rangeEndUtc)}', 3, 'UTC')
      GROUP BY date
      ORDER BY date ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /** Distinct commerce purchasers per calendar day (infra unit economics). */
  static async queryInfraCostDailyPayingUsers(rangeStartUtc, rangeEndUtc, clientTz) {
    const esc = (s) => String(s).replace(/'/g, "''");
    const tzEsc = (String(clientTz || 'UTC').trim() || 'UTC').replace(/'/g, "''");
    const table = ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW;
    const query = `
      SELECT
        toString(toDate(toTimeZone(timestamp, '${tzEsc}'))) AS date,
        uniqIf(
          user_id,
          event_name = 'purchase'
            AND object_type = 'commerce'
            AND revenue > 0
            AND user_id IS NOT NULL
            AND trimBoth(user_id) != ''
        ) AS paying_users
      FROM ${table}
      PREWHERE timestamp >= toDateTime64('${esc(rangeStartUtc)}', 3, 'UTC')
        AND timestamp <= toDateTime64('${esc(rangeEndUtc)}', 3, 'UTC')
        AND event_name = 'purchase'
        AND object_type = 'commerce'
      GROUP BY date
      ORDER BY date ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /** Distinct active users per calendar month in client TZ. */
  static async queryInfraCostMonthlyActiveUsers(rangeStartUtc, rangeEndUtc, clientTz) {
    const esc = (s) => String(s).replace(/'/g, "''");
    const tzEsc = (String(clientTz || 'UTC').trim() || 'UTC').replace(/'/g, "''");
    const table = ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW;
    const query = `
      SELECT
        formatDateTime(toDate(toTimeZone(timestamp, '${tzEsc}')), '%Y-%m') AS month,
        uniqIf(user_id, user_id IS NOT NULL AND trimBoth(user_id) != '') AS active_users
      FROM ${table}
      PREWHERE timestamp >= toDateTime64('${esc(rangeStartUtc)}', 3, 'UTC')
        AND timestamp <= toDateTime64('${esc(rangeEndUtc)}', 3, 'UTC')
      GROUP BY month
      ORDER BY month ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /** Distinct commerce purchasers per calendar month in client TZ. */
  static async queryInfraCostMonthlyPayingUsers(rangeStartUtc, rangeEndUtc, clientTz) {
    const esc = (s) => String(s).replace(/'/g, "''");
    const tzEsc = (String(clientTz || 'UTC').trim() || 'UTC').replace(/'/g, "''");
    const table = ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW;
    const query = `
      SELECT
        formatDateTime(toDate(toTimeZone(timestamp, '${tzEsc}')), '%Y-%m') AS month,
        uniqIf(
          user_id,
          revenue > 0 AND user_id IS NOT NULL AND trimBoth(user_id) != ''
        ) AS paying_users
      FROM ${table}
      PREWHERE timestamp >= toDateTime64('${esc(rangeStartUtc)}', 3, 'UTC')
        AND timestamp <= toDateTime64('${esc(rangeEndUtc)}', 3, 'UTC')
        AND event_name = 'purchase'
        AND object_type = 'commerce'
      GROUP BY month
      ORDER BY month ASC
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }
}

module.exports = AnalyticsModel;
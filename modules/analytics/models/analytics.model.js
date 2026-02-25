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

  static async getCountRevenueDailyStats(whereConditions) {
    const query = `
      SELECT sum(total_purchases) as total_count
      FROM ${ANALYTICS_CONSTANTS.TABLES.REVENUE_DAILY_STATS}
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
    const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';
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
        if(countIf(event_name = 'credit_deducted') > 0, minIf(timestamp, event_name = 'credit_deducted'), NULL) AS deducted_ts,
        if(countIf(event_name = 'credit_released') > 0, minIf(timestamp, event_name = 'credit_released'), NULL) AS released_ts
      FROM ${ANALYTICS_CONSTANTS.TABLES.ANALYTICS_EVENTS_RAW}
      WHERE object_type = 'credit'
        AND event_name IN ('credit_reserved', 'credit_deducted', 'credit_released')
        AND ${timestampConditions.join(' AND ')}
      GROUP BY user_id, object_id
      HAVING reserved_ts IS NOT NULL
    `;
    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  /**
   * Top templates by generation count (sum of tries in date range).
   * Single aggregation, no joins. Paginated via LIMIT/OFFSET for scale.
   */
  static async getTopTemplatesByGeneration(whereConditions, limit, offset) {
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
    const query = `
      SELECT
        template_id,
        sum(tries) as count
      FROM ${ANALYTICS_CONSTANTS.TABLES.TEMPLATE_DAILY_STATS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY template_id
      ORDER BY count DESC
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
}

module.exports = AnalyticsModel;
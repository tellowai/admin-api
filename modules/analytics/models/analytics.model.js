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
}

module.exports = AnalyticsModel;
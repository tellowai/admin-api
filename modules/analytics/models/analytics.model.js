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
}

module.exports = AnalyticsModel;
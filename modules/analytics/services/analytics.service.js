'use strict';

const AnalyticsModel = require('../models/analytics.model');
const ANALYTICS_CONSTANTS = require('../constants/analytics.constants');

class AnalyticsService {
  // Build datetime conditions for raw tables
  static buildDateTimeConditions(start_date, end_date, start_time, end_time) {
    const startDateFormatted = new Date(start_date).toISOString().split('T')[0];
    const endDateFormatted = new Date(end_date).toISOString().split('T')[0];
    
    const defaultStartTime = start_time || '00:00:00';
    const defaultEndTime = end_time || '23:59:59';
    
    const startDateTime = `'${startDateFormatted} ${defaultStartTime}'`;
    const endDateTime = `'${endDateFormatted} ${defaultEndTime}'`;
    
    return [`generated_at >= ${startDateTime}`, `generated_at <= ${endDateTime}`];
  }

  // Build conditions for summary tables
  static buildSummaryTableConditions(start_date, end_date, start_time, end_time, tableType) {
    const startDateFormatted = new Date(start_date).toISOString().split('T')[0];
    const endDateFormatted = new Date(end_date).toISOString().split('T')[0];
    
    let whereConditions = [];
    
    if (tableType === 'HOURLY') {
      whereConditions.push(`day >= '${startDateFormatted}'`);
      whereConditions.push(`day <= '${endDateFormatted}'`);
      
      if (start_time) {
        const startHour = parseInt(start_time.split(':')[0]);
        whereConditions.push(`hour >= ${startHour}`);
      }
      
      if (end_time) {
        const endHour = parseInt(end_time.split(':')[0]);
        whereConditions.push(`hour <= ${endHour}`);
      }
    } else if (tableType === 'DAILY') {
      whereConditions.push(`day >= '${startDateFormatted}'`);
      whereConditions.push(`day <= '${endDateFormatted}'`);
    } else if (tableType === 'MONTHLY') {
      const startMonth = new Date(start_date).toISOString().slice(0, 7);
      const endMonth = new Date(end_date).toISOString().slice(0, 7);
      
      whereConditions.push(`month >= '${startMonth}'`);
      whereConditions.push(`month <= '${endMonth}'`);
    }
    
    return whereConditions;
  }

  // Get optimal table based on date range
  static getOptimalTable(baseTableName, start_date, end_date) {
    const today = new Date().toISOString().split('T')[0];
    const startDate = new Date(start_date).toISOString().split('T')[0];
    const endDate = new Date(end_date).toISOString().split('T')[0];
    
    // If current day, use hourly table
    if (startDate === today && endDate === today) {
      return ANALYTICS_CONSTANTS.TABLES[`${baseTableName}_HOURLY`];
    }
    
    // If single previous day, use daily table
    if (startDate === endDate && startDate !== today) {
      return ANALYTICS_CONSTANTS.TABLES[`${baseTableName}_DAILY`];
    }
    
    // If date range spans a full month, use monthly table
    const startMonth = new Date(start_date).toISOString().slice(0, 7);
    const endMonth = new Date(end_date).toISOString().slice(0, 7);
    
    if (startMonth === endMonth) {
      const firstDayOfMonth = new Date(start_date).toISOString().slice(0, 8) + '01';
      const year = new Date(start_date).getFullYear();
      const month = new Date(start_date).getMonth();
      const lastDayOfMonth = new Date(year, month + 1, 0).toISOString().split('T')[0];
      
      // Check if end_date is the last day of the month
      const endDay = new Date(end_date).getDate();
      const actualLastDay = new Date(year, month + 1, 0).getDate();
      const isLastDayOfMonth = endDate === lastDayOfMonth || endDay === actualLastDay;
      
      if (startDate === firstDayOfMonth && isLastDayOfMonth) {
        return ANALYTICS_CONSTANTS.TABLES[`${baseTableName}_MONTHLY`];
      }
    }
    
    // For cross-month ranges, use daily table (much faster than raw)
    return ANALYTICS_CONSTANTS.TABLES[`${baseTableName}_DAILY`];
  }

  // Get date range periods for mixed queries
  static getDateRangePeriods(start_date, end_date) {
    const today = new Date().toISOString().split('T')[0];
    const startDate = new Date(start_date).toISOString().split('T')[0];
    const endDate = new Date(end_date).toISOString().split('T')[0];
    
    const periods = [];
    
    // If range includes today, separate it
    if (endDate === today) {
      if (startDate === today) {
        // Only today
        periods.push({
          start_date: startDate,
          end_date: endDate,
          tableType: 'HOURLY',
          isCurrentDay: true
        });
      } else {
        // Range includes today + previous days
        // Always use DAILY up to yesterday, and HOURLY for today only
        const prevDay = new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        periods.push({
          start_date: startDate,
          end_date: prevDay,
          tableType: 'DAILY',
          isCurrentDay: false
        });
        periods.push({
          start_date: today,
          end_date: today,
          tableType: 'HOURLY',
          isCurrentDay: true
        });
      }
    } else {
      // No current day in range - use DAILY/MONTHLY logic only (no HOURLY)
        // End date is not recent, use regular logic
        const startMonth = new Date(start_date).toISOString().slice(0, 7);
        const endMonth = new Date(end_date).toISOString().slice(0, 7);
        
        if (startMonth === endMonth) {
          const firstDayOfMonth = new Date(start_date).toISOString().slice(0, 8) + '01';
          const year = new Date(start_date).getFullYear();
          const month = new Date(start_date).getMonth();
          const lastDayOfMonth = new Date(year, month + 1, 0).toISOString().split('T')[0];
          
          // Check if end_date is the last day of the month
          const endDay = new Date(end_date).getDate();
          const actualLastDay = new Date(year, month + 1, 0).getDate();
          const isLastDayOfMonth = endDate === lastDayOfMonth || endDay === actualLastDay;
          
          if (startDate === firstDayOfMonth && isLastDayOfMonth) {
            // Full month
            periods.push({
              start_date: startDate,
              end_date: endDate,
              tableType: 'MONTHLY',
              isCurrentDay: false
            });
          } else {
            // Partial month - use daily
            periods.push({
              start_date: startDate,
              end_date: endDate,
              tableType: 'DAILY',
              isCurrentDay: false
            });
          }
        } else {
          // Cross-month range - use daily table (much faster than raw)
          periods.push({
            start_date: startDate,
            end_date: endDate,
            tableType: 'DAILY',
            isCurrentDay: false
          });
        }
    }
    
    return periods;
  }

  // Query mixed date range with smart table selection
  static async queryMixedDateRange(baseTableName, filters, additionalFilters = {}) {
    const { start_date, end_date, start_time, end_time } = filters;
    
    // Get date range periods
    const periods = this.getDateRangePeriods(start_date, end_date);
    
    // If only one period, use the simple approach
    if (periods.length === 1) {
      const period = periods[0];
      const tableName = ANALYTICS_CONSTANTS.TABLES[`${baseTableName}_${period.tableType}`];
      const tableType = period.tableType;
      
      let whereConditions = this.buildSummaryTableConditions(period.start_date, period.end_date, start_time, end_time, tableType);
      
      // Add additional filters
      Object.keys(additionalFilters).forEach(key => {
        if (additionalFilters[key]) {
          whereConditions.push(`${key} = '${additionalFilters[key]}'`);
        }
      });
      
      // Query appropriate table
      if (tableType === 'HOURLY') {
        return await AnalyticsModel.queryHourlyTable(tableName, whereConditions);
      } else if (tableType === 'DAILY') {
        return await AnalyticsModel.queryDailyTable(tableName, whereConditions);
      } else if (tableType === 'MONTHLY') {
        return await AnalyticsModel.queryMonthlyTable(tableName, whereConditions);
      } else {
        return await AnalyticsModel.queryRawTable(tableName, whereConditions);
      }
    }
    
    // Multiple periods - query each and combine results
    const allResults = [];
    
    for (const period of periods) {
      const tableName = ANALYTICS_CONSTANTS.TABLES[`${baseTableName}_${period.tableType}`];
      const tableType = period.tableType;
      
      let whereConditions = this.buildSummaryTableConditions(period.start_date, period.end_date, start_time, end_time, tableType);
      
      // Add additional filters
      Object.keys(additionalFilters).forEach(key => {
        if (additionalFilters[key]) {
          whereConditions.push(`${key} = '${additionalFilters[key]}'`);
        }
      });
      
      // Query appropriate table
      let results = [];
      if (tableType === 'HOURLY') {
        results = await AnalyticsModel.queryHourlyTable(tableName, whereConditions);
      } else if (tableType === 'DAILY') {
        results = await AnalyticsModel.queryDailyTable(tableName, whereConditions);
      } else if (tableType === 'MONTHLY') {
        results = await AnalyticsModel.queryMonthlyTable(tableName, whereConditions);
      } else {
        results = await AnalyticsModel.queryRawTable(tableName, whereConditions);
      }
      
      if (results && results.length > 0) {
        allResults.push(...results);
      }
    }
    
    // Combine and sort results by date
    const combinedResults = {};
    allResults.forEach(item => {
      const date = item.date;
      if (combinedResults[date]) {
        combinedResults[date].count = (parseInt(combinedResults[date].count) + parseInt(item.count)).toString();
      } else {
        combinedResults[date] = { date, count: item.count };
      }
    });
    
    return Object.values(combinedResults).sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  // Grouped by dimension within mixed date range
  static async queryMixedDateRangeGrouped(baseTableName, filters, additionalFilters = {}, groupBy) {
    const { start_date, end_date, start_time, end_time } = filters;
    const periods = this.getDateRangePeriods(start_date, end_date);

    const allResults = [];

    for (const period of periods) {
      const tableName = ANALYTICS_CONSTANTS.TABLES[`${baseTableName}_${period.tableType}`];
      const tableType = period.tableType;

      let whereConditions = this.buildSummaryTableConditions(period.start_date, period.end_date, start_time, end_time, tableType);

      Object.keys(additionalFilters).forEach(key => {
        if (additionalFilters[key]) {
          whereConditions.push(`${key} = '${additionalFilters[key]}'`);
        }
      });

      let results = [];
      if (tableType === 'HOURLY') {
        results = await AnalyticsModel.queryHourlyTableGrouped(tableName, whereConditions, groupBy);
      } else if (tableType === 'DAILY') {
        results = await AnalyticsModel.queryDailyTableGrouped(tableName, whereConditions, groupBy);
      } else if (tableType === 'MONTHLY') {
        results = await AnalyticsModel.queryMonthlyTableGrouped(tableName, whereConditions, groupBy);
      } else {
        results = await AnalyticsModel.queryRawTableGrouped(tableName, whereConditions, groupBy);
      }

      if (results && results.length > 0) {
        allResults.push(...results);
      }
    }

    // Merge across periods by (date, group_key)
    const combined = new Map();
    for (const row of allResults) {
      const key = `${row.date}__${row.group_key}`;
      const prev = combined.get(key) || 0;
      combined.set(key, prev + Number(row.count));
    }

    const mergedRows = Array.from(combined.entries()).map(([k, v]) => {
      const [date, group_key] = k.split('__');
      return { date, group_key, count: v };
    }).sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.group_key).localeCompare(String(b.group_key)));

    return mergedRows;
  }

  // Get count for mixed date range
  static async getCountMixedDateRange(baseTableName, filters, additionalFilters = {}) {
    const { start_date, end_date, start_time, end_time } = filters;
    
    // Get date range periods
    const periods = this.getDateRangePeriods(start_date, end_date);
    
    let totalCount = 0;
    
    for (const period of periods) {
      const tableName = ANALYTICS_CONSTANTS.TABLES[`${baseTableName}_${period.tableType}`];
      const tableType = period.tableType;
      
      let whereConditions = this.buildSummaryTableConditions(period.start_date, period.end_date, start_time, end_time, tableType);
      
      // Add additional filters
      Object.keys(additionalFilters).forEach(key => {
        if (additionalFilters[key]) {
          whereConditions.push(`${key} = '${additionalFilters[key]}'`);
        }
      });
      
      // Query appropriate count method
      let count = 0;
      if (tableType === 'RAW') {
        count = await AnalyticsModel.queryCountRawTable(tableName, whereConditions);
      } else {
        count = await AnalyticsModel.queryCountSummaryTable(tableName, whereConditions);
      }
      
      totalCount += count;
    }
    
    return totalCount;
  }

  // Public methods for signup and login analytics
  static async getSignups(filters) {
    const additionalFilters = {};
    if (filters.provider) additionalFilters.provider = filters.provider;
    if (filters.user_id) additionalFilters.user_id = filters.user_id;
    return this.queryMixedDateRange('SIGNUPS', filters, additionalFilters);
  }

  static async getLogins(filters) {
    const additionalFilters = {};
    if (filters.provider) additionalFilters.provider = filters.provider;
    if (filters.user_id) additionalFilters.user_id = filters.user_id;
    return this.queryMixedDateRange('LOGINS', filters, additionalFilters);
  }

  static async getPurchases(filters) {
    const additionalFilters = {};
    if (filters.plan_id) additionalFilters.plan_id = filters.plan_id;
    if (filters.plan_name) additionalFilters.plan_name = filters.plan_name;
    if (filters.plan_type) additionalFilters.plan_type = filters.plan_type;
    if (filters.payment_provider) additionalFilters.payment_provider = filters.payment_provider;
    if (filters.currency) additionalFilters.currency = filters.currency;
    if (filters.user_id) additionalFilters.user_id = filters.user_id;
    return this.queryMixedDateRange('PURCHASES', filters, additionalFilters);
  }
}

module.exports = AnalyticsService;

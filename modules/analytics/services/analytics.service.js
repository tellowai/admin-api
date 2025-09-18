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
        // Check if the previous day is also recent (data might be in hourly table)
        const prevDay = new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const prevDayObj = new Date(prevDay);
        const prevDayDiff = Math.floor((new Date(today) - prevDayObj) / (1000 * 60 * 60 * 24));
        
        if (prevDayDiff <= 1) {
          // Previous day is also recent, use hourly table for both recent days
          const dailyEndDate = new Date(new Date(prevDay).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          periods.push({
            start_date: startDate,
            end_date: dailyEndDate,
            tableType: 'DAILY',
            isCurrentDay: false
          });
          periods.push({
            start_date: prevDay,
            end_date: today,
            tableType: 'HOURLY',
            isCurrentDay: true
          });
        } else {
          // Previous day is not recent, use daily for it, hourly for today
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
      }
    } else {
      // No current day in range - check if end_date is recent (within last 2 days)
      // If so, use hourly table for the last day, daily for the rest
      const endDateObj = new Date(endDate);
      const todayObj = new Date(today);
      const daysDiff = Math.floor((todayObj - endDateObj) / (1000 * 60 * 60 * 24));
      
      if (daysDiff <= 1) {
        // End date is recent, use hourly table for it
        if (startDate === endDate) {
          // Single recent day
          periods.push({
            start_date: startDate,
            end_date: endDate,
            tableType: 'HOURLY',
            isCurrentDay: false
          });
        } else {
          // Range ending with recent day - check if start date is also recent
          const startDateObj = new Date(startDate);
          const startDaysDiff = Math.floor((todayObj - startDateObj) / (1000 * 60 * 60 * 24));
          
          if (startDaysDiff <= 1) {
            // Both start and end dates are recent, use hourly table for both
            periods.push({
              start_date: startDate,
              end_date: endDate,
              tableType: 'HOURLY',
              isCurrentDay: false
            });
          } else {
            // Start date is not recent, end date is recent
            // But we need to check if there are any recent days in between that might be in hourly table
            const prevDay = new Date(new Date(endDate).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const prevDayObj = new Date(prevDay);
            const prevDayDiff = Math.floor((todayObj - prevDayObj) / (1000 * 60 * 60 * 24));
            
            if (prevDayDiff <= 1) {
              // Previous day is also recent, use hourly table for both recent days
              const dailyEndDate = new Date(new Date(prevDay).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
              periods.push({
                start_date: startDate,
                end_date: dailyEndDate,
                tableType: 'DAILY',
                isCurrentDay: false
              });
              periods.push({
                start_date: prevDay,
                end_date: endDate,
                tableType: 'HOURLY',
                isCurrentDay: false
              });
            } else {
              // Previous day is not recent, use daily for it, hourly for end date
              periods.push({
                start_date: startDate,
                end_date: prevDay,
                tableType: 'DAILY',
                isCurrentDay: false
              });
              periods.push({
                start_date: endDate,
                end_date: endDate,
                tableType: 'HOURLY',
                isCurrentDay: false
              });
            }
          }
        }
      } else {
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

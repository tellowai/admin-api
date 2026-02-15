'use strict';

const AnalyticsModel = require('../models/analytics.model');
const ANALYTICS_CONSTANTS = require('../constants/analytics.constants');

class AnalyticsService {
  // Build conditions for MV tables (auth_daily_stats, revenue_daily_stats, template_daily_stats)
  // Uses report_date; optional filters only for allowed columns (safe from injection).
  static buildMVDateConditions(start_date, end_date) {
    const startDateFormatted = new Date(start_date).toISOString().split('T')[0];
    const endDateFormatted = new Date(end_date).toISOString().split('T')[0];
    return [`report_date >= '${startDateFormatted}'`, `report_date <= '${endDateFormatted}'`];
  }

  static buildMVAuthConditions(start_date, end_date, eventName, additionalFilters = {}) {
    const conditions = this.buildMVDateConditions(start_date, end_date);
    if (eventName) conditions.push(`event_name = '${String(eventName).replace(/'/g, "''")}'`);
    const allowed = ['provider'];
    Object.keys(additionalFilters).forEach(key => {
      if (allowed.includes(key) && additionalFilters[key] != null && additionalFilters[key] !== '') {
        const v = String(additionalFilters[key]).replace(/'/g, "''");
        conditions.push(`${key} = '${v}'`);
      }
    });
    return conditions;
  }

  static buildMVRevenueConditions(start_date, end_date, additionalFilters = {}) {
    const conditions = this.buildMVDateConditions(start_date, end_date);
    const allowed = ['currency', 'payment_provider', 'plan_name'];
    Object.keys(additionalFilters).forEach(key => {
      if (allowed.includes(key) && additionalFilters[key] != null && additionalFilters[key] !== '') {
        const v = String(additionalFilters[key]).replace(/'/g, "''");
        conditions.push(`${key} = '${v}'`);
      }
    });
    return conditions;
  }

  static buildMVTemplateConditions(start_date, end_date, additionalFilters = {}) {
    const conditions = this.buildMVDateConditions(start_date, end_date);
    const allowed = ['template_id', 'output_type', 'generation_type'];
    Object.keys(additionalFilters).forEach(key => {
      if (allowed.includes(key) && additionalFilters[key] != null && additionalFilters[key] !== '') {
        const v = String(additionalFilters[key]).replace(/'/g, "''");
        conditions.push(`${key} = '${v}'`);
      }
    });
    return conditions;
  }

  // Build conditions for daily summary tables (single table, date range only)
  static buildDailyTableConditions(start_date, end_date, additionalFilters = {}) {
    const startDateFormatted = new Date(start_date).toISOString().split('T')[0];
    const endDateFormatted = new Date(end_date).toISOString().split('T')[0];
    const conditions = [`day >= '${startDateFormatted}'`, `day <= '${endDateFormatted}'`];
    Object.keys(additionalFilters).forEach(key => {
      if (additionalFilters[key] != null && additionalFilters[key] !== '') {
        const v = String(additionalFilters[key]).replace(/'/g, "''");
        conditions.push(`${key} = '${v}'`);
      }
    });
    return conditions;
  }

  // Query mixed date range with smart table selection
  static async queryMixedDateRange(baseTableName, filters, additionalFilters = {}) {
    const { start_date, end_date } = filters;

    // Use MV tables for auth, revenue, and template (single daily table each)
    if (baseTableName === 'SIGNUPS') {
      const whereConditions = this.buildMVAuthConditions(start_date, end_date, ANALYTICS_CONSTANTS.AUTH_EVENT_NAMES.SIGNUP, additionalFilters);
      return await AnalyticsModel.queryAuthDailyStats(whereConditions);
    }
    if (baseTableName === 'LOGINS') {
      const whereConditions = this.buildMVAuthConditions(start_date, end_date, ANALYTICS_CONSTANTS.AUTH_EVENT_NAMES.LOGIN, additionalFilters);
      return await AnalyticsModel.queryAuthDailyStats(whereConditions);
    }
    if (baseTableName === 'PURCHASES') {
      const whereConditions = this.buildMVRevenueConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.queryRevenueDailyStats(whereConditions);
    }
    if (baseTableName === 'TEMPLATE_VIEWS') {
      const whereConditions = this.buildMVTemplateConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.queryTemplateDailyStats(whereConditions, ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.VIEWS);
    }
    if (baseTableName === 'TEMPLATE_TRIES') {
      const whereConditions = this.buildMVTemplateConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.queryTemplateDailyStats(whereConditions, ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.TRIES);
    }
    if (baseTableName === 'TEMPLATE_DOWNLOADS') {
      const whereConditions = this.buildMVTemplateConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.queryTemplateDailyStats(whereConditions, ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.DOWNLOADS);
    }

    // Character analytics: single daily table, one query
    const tableName = ANALYTICS_CONSTANTS.TABLES[`${baseTableName}_DAILY`];
    const whereConditions = this.buildDailyTableConditions(start_date, end_date, additionalFilters);
    return await AnalyticsModel.queryDailyTable(tableName, whereConditions);
  }

  // Grouped by dimension within mixed date range
  static async queryMixedDateRangeGrouped(baseTableName, filters, additionalFilters = {}, groupBy) {
    const { start_date, end_date, start_time, end_time } = filters;

    // Use MV tables for auth, revenue, and template (only allow allowed group_by columns)
    const authAllowed = ANALYTICS_CONSTANTS.AUTH_GROUP_BY_COLUMNS;
    const revenueAllowed = ANALYTICS_CONSTANTS.REVENUE_GROUP_BY_COLUMNS;
    const templateAllowed = ANALYTICS_CONSTANTS.TEMPLATE_GROUP_BY_COLUMNS;

    if (baseTableName === 'SIGNUPS' && authAllowed.includes(groupBy)) {
      const whereConditions = this.buildMVAuthConditions(start_date, end_date, ANALYTICS_CONSTANTS.AUTH_EVENT_NAMES.SIGNUP, additionalFilters);
      return await AnalyticsModel.queryAuthDailyStatsGrouped(whereConditions, groupBy);
    }
    if (baseTableName === 'LOGINS' && authAllowed.includes(groupBy)) {
      const whereConditions = this.buildMVAuthConditions(start_date, end_date, ANALYTICS_CONSTANTS.AUTH_EVENT_NAMES.LOGIN, additionalFilters);
      return await AnalyticsModel.queryAuthDailyStatsGrouped(whereConditions, groupBy);
    }
    if (baseTableName === 'PURCHASES' && revenueAllowed.includes(groupBy)) {
      const whereConditions = this.buildMVRevenueConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.queryRevenueDailyStatsGrouped(whereConditions, groupBy);
    }
    if (baseTableName === 'TEMPLATE_VIEWS' && templateAllowed.includes(groupBy)) {
      const whereConditions = this.buildMVTemplateConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.queryTemplateDailyStatsGrouped(whereConditions, ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.VIEWS, groupBy);
    }
    if (baseTableName === 'TEMPLATE_TRIES' && templateAllowed.includes(groupBy)) {
      const whereConditions = this.buildMVTemplateConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.queryTemplateDailyStatsGrouped(whereConditions, ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.TRIES, groupBy);
    }
    if (baseTableName === 'TEMPLATE_DOWNLOADS' && templateAllowed.includes(groupBy)) {
      const whereConditions = this.buildMVTemplateConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.queryTemplateDailyStatsGrouped(whereConditions, ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.DOWNLOADS, groupBy);
    }
    // MV tables don't support other group_by dimensions (e.g. orientation, aspect_ratio for template)
    if (['SIGNUPS', 'LOGINS'].includes(baseTableName) && groupBy && !authAllowed.includes(groupBy)) return [];
    if (baseTableName === 'PURCHASES' && groupBy && !revenueAllowed.includes(groupBy)) return [];
    if (['TEMPLATE_VIEWS', 'TEMPLATE_TRIES', 'TEMPLATE_DOWNLOADS'].includes(baseTableName) && groupBy && !templateAllowed.includes(groupBy)) return [];

    // Character analytics: single daily table, one query
    const tableName = ANALYTICS_CONSTANTS.TABLES[`${baseTableName}_DAILY`];
    const whereConditions = this.buildDailyTableConditions(start_date, end_date, additionalFilters);
    return await AnalyticsModel.queryDailyTableGrouped(tableName, whereConditions, groupBy);
  }

  // Get count for mixed date range
  static async getCountMixedDateRange(baseTableName, filters, additionalFilters = {}) {
    const { start_date, end_date, start_time, end_time } = filters;

    // Use MV tables for auth, revenue, and template
    if (baseTableName === 'SIGNUPS') {
      const whereConditions = this.buildMVAuthConditions(start_date, end_date, ANALYTICS_CONSTANTS.AUTH_EVENT_NAMES.SIGNUP, additionalFilters);
      return await AnalyticsModel.getCountAuthDailyStats(whereConditions);
    }
    if (baseTableName === 'LOGINS') {
      const whereConditions = this.buildMVAuthConditions(start_date, end_date, ANALYTICS_CONSTANTS.AUTH_EVENT_NAMES.LOGIN, additionalFilters);
      return await AnalyticsModel.getCountAuthDailyStats(whereConditions);
    }
    if (baseTableName === 'PURCHASES') {
      const whereConditions = this.buildMVRevenueConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.getCountRevenueDailyStats(whereConditions);
    }
    if (baseTableName === 'TEMPLATE_VIEWS') {
      const whereConditions = this.buildMVTemplateConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.getCountTemplateDailyStats(whereConditions, ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.VIEWS);
    }
    if (baseTableName === 'TEMPLATE_TRIES') {
      const whereConditions = this.buildMVTemplateConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.getCountTemplateDailyStats(whereConditions, ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.TRIES);
    }
    if (baseTableName === 'TEMPLATE_DOWNLOADS') {
      const whereConditions = this.buildMVTemplateConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.getCountTemplateDailyStats(whereConditions, ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.DOWNLOADS);
    }

    // Character analytics: single daily table, one query
    const tableName = ANALYTICS_CONSTANTS.TABLES[`${baseTableName}_DAILY`];
    const whereConditions = this.buildDailyTableConditions(start_date, end_date, additionalFilters);
    return await AnalyticsModel.queryCountSummaryTable(tableName, whereConditions);
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

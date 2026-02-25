'use strict';

const AnalyticsModel = require('../models/analytics.model');
const TemplateModel = require('../../templates/models/template.model');
const ANALYTICS_CONSTANTS = require('../constants/analytics.constants');

/** Epoch/sentinel from ClickHouse minIf/maxIf when no rows match – treat as null (year 2000 boundary). Defensive: query now uses countIf to return NULL, but parser still normalizes any sentinel. */
const CLICKHOUSE_EPOCH_SENTINEL_MS = 946684800000;

/** Stuck job: reserved at least this long ago (1h) to count as stuck on a given day. 60 * 60 * 1000 */
const STUCK_THRESHOLD_MS = 3600000;
/** Milliseconds per day. 24 * 60 * 60 * 1000 */
const MS_PER_DAY = 86400000;

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

  static buildMVCreditsConditions(start_date, end_date, additionalFilters = {}) {
    const conditions = this.buildMVDateConditions(start_date, end_date);
    const allowed = ['reason', 'country'];
    Object.keys(additionalFilters).forEach(key => {
      if (allowed.includes(key) && additionalFilters[key] != null && additionalFilters[key] !== '') {
        const v = String(additionalFilters[key]).replace(/'/g, "''");
        conditions.push(`${key} = '${v}'`);
      }
    });
    return conditions;
  }

  static buildPipelineAIConditions(start_date, end_date, additionalFilters = {}) {
    const conditions = this.buildMVDateConditions(start_date, end_date);
    const allowed = ['template_id', 'provider_name', 'model_name'];
    Object.keys(additionalFilters).forEach(key => {
      if (allowed.includes(key) && additionalFilters[key] != null && additionalFilters[key] !== '') {
        const v = String(additionalFilters[key]).replace(/'/g, "''");
        conditions.push(`${key} = '${v}'`);
      }
    });
    return conditions;
  }

  static buildPipelineAEConditions(start_date, end_date, additionalFilters = {}) {
    const conditions = this.buildMVDateConditions(start_date, end_date);
    const allowed = ['template_id', 'ae_version'];
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
    if (baseTableName === 'TEMPLATE_SUCCESSES') {
      const whereConditions = this.buildMVTemplateConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.queryTemplateDailyStats(whereConditions, ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.SUCCESSES);
    }
    if (baseTableName === 'TEMPLATE_FAILURES') {
      const whereConditions = this.buildMVTemplateConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.queryTemplateDailyStats(whereConditions, ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.FAILURES);
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
    if (baseTableName === 'TEMPLATE_SUCCESSES' && templateAllowed.includes(groupBy)) {
      const whereConditions = this.buildMVTemplateConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.queryTemplateDailyStatsGrouped(whereConditions, ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.SUCCESSES, groupBy);
    }
    if (baseTableName === 'TEMPLATE_FAILURES' && templateAllowed.includes(groupBy)) {
      const whereConditions = this.buildMVTemplateConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.queryTemplateDailyStatsGrouped(whereConditions, ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.FAILURES, groupBy);
    }
    // MV tables don't support other group_by dimensions (e.g. orientation, aspect_ratio for template)
    if (['SIGNUPS', 'LOGINS'].includes(baseTableName) && groupBy && !authAllowed.includes(groupBy)) return [];
    if (baseTableName === 'PURCHASES' && groupBy && !revenueAllowed.includes(groupBy)) return [];
    if (['TEMPLATE_VIEWS', 'TEMPLATE_TRIES', 'TEMPLATE_DOWNLOADS', 'TEMPLATE_SUCCESSES', 'TEMPLATE_FAILURES'].includes(baseTableName) && groupBy && !templateAllowed.includes(groupBy)) return [];

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
    if (baseTableName === 'TEMPLATE_SUCCESSES') {
      const whereConditions = this.buildMVTemplateConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.getCountTemplateDailyStats(whereConditions, ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.SUCCESSES);
    }
    if (baseTableName === 'TEMPLATE_FAILURES') {
      const whereConditions = this.buildMVTemplateConditions(start_date, end_date, additionalFilters);
      return await AnalyticsModel.getCountTemplateDailyStats(whereConditions, ANALYTICS_CONSTANTS.TEMPLATE_MEASURES.FAILURES);
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

  static async getTopTemplatesByGeneration(filters) {
    const { start_date, end_date, page = 1, limit = 20 } = filters;
    const whereConditions = this.buildMVTemplateConditions(start_date, end_date, {});
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const rows = await AnalyticsModel.getTopTemplatesByGeneration(whereConditions, safeLimit, offset);
    if (!rows || rows.length === 0) {
      return [];
    }
    const templateIds = rows.map(r => r.template_id).filter(Boolean);
    const templates = await TemplateModel.getTemplatesByIdsForAnalytics(templateIds);
    const byId = {};
    (templates || []).forEach(t => { byId[t.template_id] = t; });
    return rows.map(row => {
      const t = byId[row.template_id] || {};
      return {
        template_id: row.template_id,
        count: row.count,
        template_name: t.template_name ?? row.template_id ?? null,
        template_code: t.template_code ?? null,
        template_gender: t.template_gender ?? null,
        template_output_type: t.template_output_type ?? null,
        thumb_frame_bucket: t.thumb_frame_bucket ?? null,
        thumb_frame_asset_key: t.thumb_frame_asset_key ?? null,
        cf_r2_url: t.cf_r2_url ?? null
      };
    });
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

  static async getCreditsDailyStats(filters) {
    const { start_date, end_date } = filters;
    const additionalFilters = {};
    if (filters.reason != null && filters.reason !== '') additionalFilters.reason = filters.reason;
    if (filters.country != null && filters.country !== '') additionalFilters.country = filters.country;
    const whereConditions = this.buildMVCreditsConditions(start_date, end_date, additionalFilters);
    if (filters.group_by && ANALYTICS_CONSTANTS.CREDITS_GROUP_BY_COLUMNS.includes(filters.group_by)) {
      return AnalyticsModel.queryCreditsDailyStatsGrouped(whereConditions, filters.group_by);
    }
    return AnalyticsModel.queryCreditsDailyStats(whereConditions);
  }

  static async getCreditsSummary(filters) {
    const { start_date, end_date } = filters;
    const additionalFilters = {};
    if (filters.reason != null && filters.reason !== '') additionalFilters.reason = filters.reason;
    if (filters.country != null && filters.country !== '') additionalFilters.country = filters.country;
    const whereConditions = this.buildMVCreditsConditions(start_date, end_date, additionalFilters);
    return AnalyticsModel.getCreditsSummary(whereConditions);
  }

  static async getAIExecutionSummary(filters) {
    const { start_date, end_date } = filters;
    const additionalFilters = {};
    if (filters.template_id) additionalFilters.template_id = filters.template_id;
    if (filters.provider_name) additionalFilters.provider_name = filters.provider_name;
    if (filters.model_name) additionalFilters.model_name = filters.model_name;
    const whereConditions = this.buildPipelineAIConditions(start_date, end_date, additionalFilters);
    const rows = await AnalyticsModel.queryAIExecutionSummary(whereConditions);
    if (!rows || rows.length === 0) return null;
    let total_runs = 0;
    let successful_runs = 0;
    let total_duration_ms = 0;
    let total_queue_ms = 0;
    let total_cost = 0;
    for (const r of rows) {
      const runs = Number(r.total_runs) || 0;
      total_runs += runs;
      if (r.status === 'success') {
        successful_runs += runs;
        total_duration_ms += Number(r.total_duration_ms) || 0;
      }
      total_queue_ms += Number(r.total_queue_ms) || 0;
      total_cost += Number(r.total_cost) || 0;
    }
    return {
      total_runs,
      successful_runs,
      failed_runs: total_runs - successful_runs,
      success_rate_pct: total_runs ? Math.round((successful_runs / total_runs) * 10000) / 100 : 0,
      avg_duration_ms: successful_runs ? Math.round(total_duration_ms / successful_runs) : 0,
      total_queue_ms,
      avg_queue_ms: total_runs ? Math.round(total_queue_ms / total_runs) : 0,
      total_cost
    };
  }

  static async getAIExecutionByModel(filters) {
    const { start_date, end_date } = filters;
    const additionalFilters = {};
    if (filters.template_id) additionalFilters.template_id = filters.template_id;
    if (filters.provider_name) additionalFilters.provider_name = filters.provider_name;
    if (filters.model_name) additionalFilters.model_name = filters.model_name;
    const whereConditions = this.buildPipelineAIConditions(start_date, end_date, additionalFilters);
    const rows = await AnalyticsModel.queryAIExecutionByModel(whereConditions);
    if (!rows || rows.length === 0) return [];
    const byKey = {};
    for (const r of rows) {
      const key = `${r.model_name || ''}\t${r.provider_name || ''}`;
      if (!byKey[key]) {
        byKey[key] = { model_name: r.model_name, provider_name: r.provider_name, total_runs: 0, successful_runs: 0, total_duration_ms: 0, total_queue_ms: 0, total_cost: 0 };
      }
      const runs = Number(r.total_runs) || 0;
      byKey[key].total_runs += runs;
      if (r.status === 'success') {
        byKey[key].successful_runs += runs;
        byKey[key].total_duration_ms += Number(r.total_duration_ms) || 0;
      }
      byKey[key].total_queue_ms += Number(r.total_queue_ms) || 0;
      byKey[key].total_cost += Number(r.total_cost) || 0;
    }
    return Object.values(byKey)
      .map((x) => ({
        model_name: x.model_name,
        provider_name: x.provider_name,
        total_runs: x.total_runs,
        successful_runs: x.successful_runs,
        success_rate_pct: x.total_runs ? Math.round((x.successful_runs / x.total_runs) * 10000) / 100 : 0,
        avg_duration_ms: x.successful_runs ? Math.round(x.total_duration_ms / x.successful_runs) : 0,
        avg_queue_ms: x.total_runs ? Math.round(x.total_queue_ms / x.total_runs) : 0,
        total_cost: x.total_cost
      }))
      .sort((a, b) => (b.total_runs - a.total_runs) || String(a.model_name).localeCompare(b.model_name));
  }

  static async getAIExecutionByDay(filters) {
    const { start_date, end_date } = filters;
    const additionalFilters = {};
    if (filters.template_id) additionalFilters.template_id = filters.template_id;
    if (filters.provider_name) additionalFilters.provider_name = filters.provider_name;
    if (filters.model_name) additionalFilters.model_name = filters.model_name;
    const whereConditions = this.buildPipelineAIConditions(start_date, end_date, additionalFilters);
    const rows = await AnalyticsModel.queryAIExecutionByDay(whereConditions);
    if (!rows || rows.length === 0) return [];
    const byKey = {};
    for (const r of rows) {
      const key = `${r.date}\t${r.model_name || ''}`;
      if (!byKey[key]) {
        byKey[key] = { date: r.date, model_name: r.model_name, total_runs: 0, successful_runs: 0, total_duration_ms: 0 };
      }
      const runs = Number(r.total_runs) || 0;
      byKey[key].total_runs += runs;
      if (r.status === 'success') {
        byKey[key].successful_runs += runs;
        byKey[key].total_duration_ms += Number(r.total_duration_ms) || 0;
      }
    }
    return Object.values(byKey)
      .map((x) => ({
        date: x.date,
        model_name: x.model_name,
        total_runs: x.total_runs,
        successful_runs: x.successful_runs,
        avg_duration_ms: x.successful_runs ? Math.round(x.total_duration_ms / x.successful_runs) : 0
      }))
      .sort((a, b) => String(b.date).localeCompare(a.date) || String(a.model_name).localeCompare(b.model_name));
  }

  static async getAIExecutionCostByTemplate(filters) {
    const { start_date, end_date } = filters;
    const additionalFilters = {};
    if (filters.provider_name) additionalFilters.provider_name = filters.provider_name;
    if (filters.model_name) additionalFilters.model_name = filters.model_name;
    const whereConditions = this.buildPipelineAIConditions(start_date, end_date, additionalFilters);
    const rows = await AnalyticsModel.queryAIExecutionCostByTemplate(whereConditions);
    if (!rows || rows.length === 0) return [];
    const byTemplate = {};
    for (const r of rows) {
      const tid = r.template_id || '';
      if (!byTemplate[tid]) byTemplate[tid] = { template_id: tid, total_calls: 0, total_cost_usd: 0 };
      byTemplate[tid].total_calls += Number(r.total_calls) || 0;
      byTemplate[tid].total_cost_usd += Number(r.total_cost_usd) || 0;
    }
    return Object.values(byTemplate)
      .map((x) => ({
        ...x,
        avg_cost_per_call: x.total_calls > 0 ? Math.round((x.total_cost_usd / x.total_calls) * 10000) / 10000 : 0
      }))
      .sort((a, b) => b.total_cost_usd - a.total_cost_usd);
  }

  static async getAIExecutionCostByDay(filters) {
    const { start_date, end_date } = filters;
    const additionalFilters = {};
    if (filters.template_id) additionalFilters.template_id = filters.template_id;
    if (filters.provider_name) additionalFilters.provider_name = filters.provider_name;
    if (filters.model_name) additionalFilters.model_name = filters.model_name;
    const whereConditions = this.buildPipelineAIConditions(start_date, end_date, additionalFilters);
    const rows = await AnalyticsModel.queryAIExecutionCostByDay(whereConditions);
    if (!rows || rows.length === 0) return [];
    const byKey = {};
    for (const r of rows) {
      const key = `${r.date}\t${r.provider_name || ''}`;
      if (!byKey[key]) byKey[key] = { date: r.date, provider_name: r.provider_name, total_cost: 0 };
      byKey[key].total_cost += Number(r.total_cost) || 0;
    }
    return Object.values(byKey).sort((a, b) => String(a.date).localeCompare(b.date) || String(a.provider_name).localeCompare(b.provider_name));
  }

  static async getAIExecutionByErrorCategory(filters) {
    const { start_date, end_date } = filters;
    const additionalFilters = {};
    if (filters.template_id) additionalFilters.template_id = filters.template_id;
    if (filters.provider_name) additionalFilters.provider_name = filters.provider_name;
    if (filters.model_name) additionalFilters.model_name = filters.model_name;
    const whereConditions = this.buildPipelineAIConditions(start_date, end_date, additionalFilters);
    const rows = await AnalyticsModel.queryAIExecutionByErrorCategory(whereConditions);
    if (!rows || rows.length === 0) return [];
    const byCat = {};
    for (const r of rows) {
      if (r.status !== 'failed') continue;
      const cat = r.error_category && String(r.error_category).trim() ? String(r.error_category) : 'unknown';
      if (!byCat[cat]) byCat[cat] = { error_category: cat, failed_runs: 0 };
      byCat[cat].failed_runs += Number(r.total_runs) || 0;
    }
    return Object.values(byCat)
      .filter((x) => x.failed_runs > 0)
      .sort((a, b) => b.failed_runs - a.failed_runs);
  }

  static async getAERenderingSummary(filters) {
    const { start_date, end_date } = filters;
    const additionalFilters = {};
    if (filters.template_id) additionalFilters.template_id = filters.template_id;
    if (filters.ae_version) additionalFilters.ae_version = filters.ae_version;
    const whereConditions = this.buildPipelineAEConditions(start_date, end_date, additionalFilters);
    const rows = await AnalyticsModel.queryAERenderingSummary(whereConditions);
    if (!rows || rows.length === 0) return null;
    const row = { total_jobs: 0, total_job_time_ms: 0, total_validation_ms: 0, total_asset_download_ms: 0, total_template_download_ms: 0, total_user_assets_download_ms: 0, total_composition_ms: 0, total_bundling_ms: 0, total_rendering_ms: 0, total_upload_ms: 0 };
    for (const r of rows) {
      row.total_jobs += Number(r.total_jobs) || 0;
      row.total_job_time_ms += Number(r.total_job_time_ms) || 0;
      row.total_validation_ms += Number(r.total_validation_ms) || 0;
      row.total_asset_download_ms += Number(r.total_asset_download_ms) || 0;
      row.total_template_download_ms += Number(r.total_template_download_ms) || 0;
      row.total_user_assets_download_ms += Number(r.total_user_assets_download_ms) || 0;
      row.total_composition_ms += Number(r.total_composition_ms) || 0;
      row.total_bundling_ms += Number(r.total_bundling_ms) || 0;
      row.total_rendering_ms += Number(r.total_rendering_ms) || 0;
      row.total_upload_ms += Number(r.total_upload_ms) || 0;
    }
    const successful_jobs = rows.filter((r) => r.status === 'success').reduce((s, r) => s + (Number(r.total_jobs) || 0), 0);
    const failed_jobs = row.total_jobs - successful_jobs;
    const total = Number(row.total_job_time_ms) || 1;
    return {
      ...row,
      successful_jobs,
      failed_jobs,
      success_rate_pct: row.total_jobs ? Math.round((successful_jobs / row.total_jobs) * 10000) / 100 : 0,
      failure_rate_pct: row.total_jobs ? Math.round((failed_jobs / row.total_jobs) * 10000) / 100 : 0,
      avg_job_time_ms: row.total_jobs ? Math.round(row.total_job_time_ms / row.total_jobs) : 0,
      pct_validation: total ? Math.round((row.total_validation_ms / total) * 1000) / 10 : 0,
      pct_asset_download: total ? Math.round((row.total_asset_download_ms / total) * 1000) / 10 : 0,
      pct_template_download: total ? Math.round((row.total_template_download_ms / total) * 1000) / 10 : 0,
      pct_user_assets_download: total ? Math.round((row.total_user_assets_download_ms / total) * 1000) / 10 : 0,
      pct_composition: total ? Math.round((row.total_composition_ms / total) * 1000) / 10 : 0,
      pct_bundling: total ? Math.round((row.total_bundling_ms / total) * 1000) / 10 : 0,
      pct_rendering: total ? Math.round((row.total_rendering_ms / total) * 1000) / 10 : 0,
      pct_upload: total ? Math.round((row.total_upload_ms / total) * 1000) / 10 : 0
    };
  }

  static async getAERenderingByVersion(filters) {
    const { start_date, end_date } = filters;
    const additionalFilters = {};
    if (filters.template_id) additionalFilters.template_id = filters.template_id;
    if (filters.ae_version) additionalFilters.ae_version = filters.ae_version;
    const whereConditions = this.buildPipelineAEConditions(start_date, end_date, additionalFilters);
    const rows = await AnalyticsModel.queryAERenderingByVersion(whereConditions);
    if (!rows || rows.length === 0) return [];
    const byVersion = {};
    for (const r of rows) {
      const v = r.ae_version || '';
      if (!byVersion[v]) {
        byVersion[v] = { ae_version: v, total_jobs: 0, successful_jobs: 0, total_job_time_ms: 0, total_rendering_ms: 0, total_upload_ms: 0 };
      }
      const jobs = Number(r.total_jobs) || 0;
      byVersion[v].total_jobs += jobs;
      if (r.status === 'success') byVersion[v].successful_jobs += jobs;
      byVersion[v].total_job_time_ms += Number(r.total_job_time_ms) || 0;
      byVersion[v].total_rendering_ms += Number(r.total_rendering_ms) || 0;
      byVersion[v].total_upload_ms += Number(r.total_upload_ms) || 0;
    }
    return Object.values(byVersion)
      .map((x) => ({
        ae_version: x.ae_version,
        total_jobs: x.total_jobs,
        successful_jobs: x.successful_jobs,
        success_rate_pct: x.total_jobs ? Math.round((x.successful_jobs / x.total_jobs) * 10000) / 100 : 0,
        avg_job_time_ms: x.total_jobs ? Math.round(x.total_job_time_ms / x.total_jobs) : 0,
        total_rendering_ms: x.total_rendering_ms,
        total_upload_ms: x.total_upload_ms,
        total_job_time_ms: x.total_job_time_ms
      }))
      .sort((a, b) => b.total_jobs - a.total_jobs);
  }

  static async getAERenderingByDay(filters) {
    const { start_date, end_date } = filters;
    const additionalFilters = {};
    if (filters.template_id) additionalFilters.template_id = filters.template_id;
    if (filters.ae_version) additionalFilters.ae_version = filters.ae_version;
    const whereConditions = this.buildPipelineAEConditions(start_date, end_date, additionalFilters);
    const rows = await AnalyticsModel.queryAERenderingByDay(whereConditions);
    if (!rows || rows.length === 0) return [];
    const byKey = {};
    for (const r of rows) {
      const key = `${r.date}\t${r.ae_version || ''}`;
      if (!byKey[key]) byKey[key] = { date: r.date, ae_version: r.ae_version, total_jobs: 0, total_job_time_ms: 0 };
      byKey[key].total_jobs += Number(r.total_jobs) || 0;
      byKey[key].total_job_time_ms += Number(r.total_job_time_ms) || 0;
    }
    return Object.values(byKey)
      .map((x) => ({
        ...x,
        avg_job_time_ms: x.total_jobs > 0 ? Math.round(x.total_job_time_ms / x.total_jobs) : 0
      }))
      .sort((a, b) => String(b.date).localeCompare(a.date) || String(a.ae_version).localeCompare(b.ae_version));
  }

  static async getAERenderingByDayWithStatus(filters) {
    const { start_date, end_date } = filters;
    const additionalFilters = {};
    if (filters.template_id) additionalFilters.template_id = filters.template_id;
    if (filters.ae_version) additionalFilters.ae_version = filters.ae_version;
    const whereConditions = this.buildPipelineAEConditions(start_date, end_date, additionalFilters);
    const rows = await AnalyticsModel.queryAERenderingByDayWithStatus(whereConditions);
    if (!rows || rows.length === 0) return [];
    const byDate = {};
    for (const r of rows) {
      const d = r.date;
      if (!byDate[d]) byDate[d] = { date: d, total_jobs: 0, successful_jobs: 0 };
      const jobs = Number(r.total_jobs) || 0;
      byDate[d].total_jobs += jobs;
      if (r.status === 'success') byDate[d].successful_jobs += jobs;
    }
    return Object.values(byDate)
      .map((x) => ({ ...x, success_rate_pct: x.total_jobs ? Math.round((x.successful_jobs / x.total_jobs) * 10000) / 100 : 0 }))
      .sort((a, b) => String(a.date).localeCompare(b.date));
  }

  static async getAERenderingStepsByDay(filters) {
    const { start_date, end_date } = filters;
    const additionalFilters = {};
    if (filters.template_id) additionalFilters.template_id = filters.template_id;
    if (filters.ae_version) additionalFilters.ae_version = filters.ae_version;
    const whereConditions = this.buildPipelineAEConditions(start_date, end_date, additionalFilters);
    const rows = await AnalyticsModel.queryAERenderingStepsByDay(whereConditions);
    if (!rows || rows.length === 0) return [];
    const byDate = {};
    for (const r of rows) {
      const d = r.date;
      if (!byDate[d]) {
        byDate[d] = {
          date: d,
          network_ms: 0,
          compute_ms: 0
        };
      }
      byDate[d].network_ms += (Number(r.total_asset_download_ms) || 0) + (Number(r.total_template_download_ms) || 0) + (Number(r.total_upload_ms) || 0);
      byDate[d].compute_ms += (Number(r.total_composition_ms) || 0) + (Number(r.total_bundling_ms) || 0) + (Number(r.total_rendering_ms) || 0);
    }
    return Object.values(byDate).sort((a, b) => String(a.date).localeCompare(b.date));
  }

  static async getAERenderingByErrorCategory(filters) {
    const { start_date, end_date } = filters;
    const additionalFilters = {};
    if (filters.template_id) additionalFilters.template_id = filters.template_id;
    if (filters.ae_version) additionalFilters.ae_version = filters.ae_version;
    const whereConditions = this.buildPipelineAEConditions(start_date, end_date, additionalFilters);
    const rows = await AnalyticsModel.queryAERenderingByErrorCategory(whereConditions);
    if (!rows || rows.length === 0) return [];
    const byCategory = {};
    for (const r of rows) {
      const cat = r.error_category != null && String(r.error_category).trim() !== '' ? String(r.error_category) : '(empty)';
      if (!byCategory[cat]) byCategory[cat] = { error_category: cat, failed_jobs: 0 };
      if (r.status === 'failed') byCategory[cat].failed_jobs += Number(r.total_jobs) || 0;
    }
    return Object.values(byCategory)
      .filter((x) => x.failed_jobs > 0)
      .sort((a, b) => b.failed_jobs - a.failed_jobs);
  }

  /** All-time credits totals: single simple query, no date filter, optional reason/country only. */
  static async getCreditsSummaryAllTime(filters = {}) {
    const conditions = [];
    const allowed = ['reason', 'country'];
    allowed.forEach(key => {
      if (filters[key] != null && filters[key] !== '') {
        const v = String(filters[key]).replace(/'/g, "''");
        conditions.push(`${key} = '${v}'`);
      }
    });
    return AnalyticsModel.getCreditsSummaryAllTime(conditions);
  }

  /**
   * Parse timestamp from ClickHouse (string "YYYY-MM-DD HH:mm:ss[.sss]", number, or Date).
   * Treats datetime strings as UTC. Returns null for epoch/sentinel (e.g. "1970-01-01 05:30:00" from minIf when no match).
   */
  static _parseClickHouseTimestamp(value) {
    if (value == null) return null;
    if (value instanceof Date) {
      const t = value.getTime();
      if (Number.isNaN(t) || t < CLICKHOUSE_EPOCH_SENTINEL_MS) return null;
      return value;
    }
    if (typeof value === 'number') {
      if (value < CLICKHOUSE_EPOCH_SENTINEL_MS) return null;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const s = String(value).trim();
    if (!s || s.startsWith('1970-01-01')) return null; // ClickHouse "no value" often comes as 1970-01-01 in server TZ
    // ClickHouse returns "YYYY-MM-DD HH:mm:ss.sss" – parse as UTC
    const iso = s.includes('T') ? s : s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z');
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()) || d.getTime() < CLICKHOUSE_EPOCH_SENTINEL_MS) return null;
    return d;
  }

  /**
   * Returns UTC date string (YYYY-MM-DD) for a Date at midnight UTC.
   */
  static _toDateStr(d) {
    return d.toISOString().slice(0, 10);
  }

  /**
   * End-of-day (23:59:59.999) UTC for the given date.
   */
  static _endOfDayUtc(year, month, date) {
    return new Date(Date.UTC(year, month, date, 23, 59, 59, 999));
  }

  /**
   * Which days in [startDayUtc, endDayUtc] was this job stuck?
   * Stuck on day D = reserved by (end of D - 1hr) and not deducted/released by end of D.
   * Starts from reservation day to avoid scanning earlier days.
   */
  static _stuckDaysForJob(reservedTs, finalizedTs, startDayUtc, endDayUtc) {
    const days = [];
    const reservedDayUtc = new Date(Date.UTC(reservedTs.getUTCFullYear(), reservedTs.getUTCMonth(), reservedTs.getUTCDate()));
    const firstDayMs = Math.max(startDayUtc.getTime(), reservedDayUtc.getTime());
    const lastDayMs = endDayUtc.getTime();
    for (let dayMs = firstDayMs; dayMs <= lastDayMs; dayMs += MS_PER_DAY) {
      const d = new Date(dayMs);
      const endOfDay = this._endOfDayUtc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      const cutoff = new Date(endOfDay.getTime() - STUCK_THRESHOLD_MS);
      if (reservedTs > cutoff) continue;
      if (finalizedTs && finalizedTs <= endOfDay) break; // no later days can be stuck
      days.push(this._toDateStr(d));
    }
    return days;
  }

  /**
   * Stuck credits: daily series of stuck_job_count and stuck_user_count (1hr threshold).
   * Single pass over rows; O(rows + days) instead of O(days × rows).
   */
  static async getCreditsStuckCounts(filters) {
    const { start_date, end_date } = filters;
    const start = new Date(start_date);
    const end = new Date(end_date);
    start.setUTCHours(0, 0, 0, 0);
    end.setUTCHours(23, 59, 59, 999);
    const startStr = start.toISOString().slice(0, 19).replace('T', ' ');
    const endStr = end.toISOString().slice(0, 19).replace('T', ' ');
    const timestampConditions = [
      `timestamp >= '${startStr}'`,
      `timestamp <= '${endStr}'`
    ];
    const rows = await AnalyticsModel.queryCreditsStuckJobsFromRaw(timestampConditions);
    const startDayUtc = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const endDayUtc = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

    // Pre-fill one bucket per day; then single pass over rows
    const buckets = new Map();
    for (let t = startDayUtc.getTime(); t <= endDayUtc.getTime(); t += MS_PER_DAY) {
      const dateStr = this._toDateStr(new Date(t));
      buckets.set(dateStr, { jobCount: 0, userSet: new Set() });
    }

    for (const row of rows) {
      const reservedTs = this._parseClickHouseTimestamp(row.reserved_ts);
      if (!reservedTs) continue;
      const deductedTs = this._parseClickHouseTimestamp(row.deducted_ts);
      const releasedTs = this._parseClickHouseTimestamp(row.released_ts);
      const finalizedTs = [deductedTs, releasedTs].filter(Boolean).sort((a, b) => a - b)[0] || null;
      const stuckDays = this._stuckDaysForJob(reservedTs, finalizedTs, startDayUtc, endDayUtc);
      const userId = row.user_id ? String(row.user_id) : null;
      for (const dateStr of stuckDays) {
        const b = buckets.get(dateStr);
        if (b) {
          b.jobCount += 1;
          if (userId) b.userSet.add(userId);
        }
      }
    }

    const sortedDates = [...buckets.keys()].sort();
    return sortedDates.map(dateStr => {
      const b = buckets.get(dateStr);
      return {
        date: dateStr,
        stuck_job_count: b.jobCount,
        stuck_user_count: b.userSet.size
      };
    });
  }
}

module.exports = AnalyticsService;

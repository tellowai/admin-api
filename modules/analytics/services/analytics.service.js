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

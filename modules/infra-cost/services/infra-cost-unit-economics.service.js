'use strict';

const moment = require('moment-timezone');
const TimezoneService = require('../../analytics/services/timezone.service');
const AnalyticsModel = require('../../analytics/models/analytics.model');
const { convertToReporting, DEFAULT_FX_TO_EUR, eurToInr, getEurToInrRate } = require('./fx.service');

const KNOWN_PROVIDERS = ['hetzner', 'digitalocean', 'aws'];
const REPORTING_CURRENCY = 'EUR';

function roundMoney(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

function roundRatio(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 1000000) / 1000000;
}

function safeDivide(numerator, denominator) {
  const d = Number(denominator);
  if (!Number.isFinite(d) || d <= 0) return null;
  const n = Number(numerator);
  if (!Number.isFinite(n)) return null;
  return n / d;
}

function buildDateKeys(startCal, endCal, tz) {
  const z = moment.tz.zone(tz) != null ? tz : 'UTC';
  const keys = [];
  const startM = moment.tz(startCal, z).startOf('day');
  const endM = moment.tz(endCal, z).startOf('day');
  for (let m = startM.clone(); m.isSameOrBefore(endM, 'day'); m.add(1, 'day')) {
    keys.push(m.format('YYYY-MM-DD'));
  }
  return keys;
}

function buildMonthKeys(startCal, endCal, tz) {
  const z = moment.tz.zone(tz) != null ? tz : 'UTC';
  const keys = [];
  const startM = moment.tz(startCal, z).startOf('month');
  const endM = moment.tz(endCal, z).startOf('month');
  for (let m = startM.clone(); m.isSameOrBefore(endM, 'month'); m.add(1, 'month')) {
    keys.push(m.format('YYYY-MM'));
  }
  return keys;
}

function mapCountRows(rows, valueKey, dateKey = 'date') {
  const map = new Map();
  for (const r of rows || []) {
    map.set(String(r[dateKey]), Number(r[valueKey]) || 0);
  }
  return map;
}

function deriveCombinedStatus(statuses) {
  const list = statuses || [];
  if (!list.length) return 'missing';
  const okish = list.filter((s) => s === 'ok' || s === 'partial');
  const failed = list.filter((s) => s === 'failed');
  const skipped = list.filter((s) => s === 'skipped');
  if (okish.length && failed.length) return 'partial';
  if (okish.length && okish.length < list.length && skipped.length) return 'partial';
  if (okish.length) return okish.some((s) => s === 'partial') ? 'partial' : 'ok';
  if (failed.length) return 'failed';
  if (skipped.length === list.length) return 'skipped';
  return 'missing';
}

/**
 * Group MySQL rows by date; sum provider costs into reporting currency (EUR).
 */
function groupInfraRowsByDate(rows, fxTable) {
  const byDate = new Map();

  for (const r of rows || []) {
    const d =
      r.cost_date instanceof Date
        ? moment.utc(r.cost_date).format('YYYY-MM-DD')
        : String(r.cost_date).slice(0, 10);

    if (!byDate.has(d)) {
      byDate.set(d, {
        providers: {},
        statuses: [],
        total_reporting: 0,
        resource_count: 0,
        has_billable: false
      });
    }

    const bucket = byDate.get(d);
    const native = Number(r.estimated_total_net);
    const status = r.status || 'ok';
    const reporting = convertToReporting(native, r.currency, REPORTING_CURRENCY, fxTable);

    bucket.providers[r.provider] = {
      status,
      currency: r.currency || 'EUR',
      cost_native: roundMoney(native),
      cost_reporting: roundMoney(reporting),
      resource_count: Number(r.resource_count) || 0,
      error_message: r.error_message || null
    };

    bucket.statuses.push(status);
    bucket.resource_count += Number(r.resource_count) || 0;

    if ((status === 'ok' || status === 'partial') && reporting != null) {
      bucket.total_reporting += reporting;
      bucket.has_billable = true;
    }
  }

  for (const [, bucket] of byDate) {
    bucket.infra_status = deriveCombinedStatus(bucket.statuses);
    bucket.total_reporting = roundMoney(bucket.total_reporting);
  }

  return byDate;
}

function enrichProvidersWithInr(providers, eurToInrRate) {
  const out = {};
  for (const [pid, pdata] of Object.entries(providers || {})) {
    const costEur = pdata.cost_reporting ?? pdata.cost_eur ?? null;
    out[pid] = {
      ...pdata,
      cost_eur: costEur,
      cost_inr: eurToInr(costEur, eurToInrRate)
    };
  }
  return out;
}

function enrichSeriesRowWithInr(row, eurToInrRate) {
  const providersCostInr = {};
  for (const [pid, costEur] of Object.entries(row.providers_cost_eur || {})) {
    providersCostInr[pid] = eurToInr(costEur, eurToInrRate);
  }
  return {
    ...row,
    infra_cost_inr: eurToInr(row.infra_cost_eur, eurToInrRate),
    cost_per_active_user_inr: eurToInr(row.cost_per_active_user, eurToInrRate),
    cost_per_paying_user_inr: eurToInr(row.cost_per_paying_user, eurToInrRate),
    providers: enrichProvidersWithInr(row.providers, eurToInrRate),
    providers_cost_inr: providersCostInr
  };
}

function aggregateMonthlyFromDaily(dailySeries) {
  const byMonth = new Map();
  for (const row of dailySeries) {
    const month = row.date.slice(0, 7);
    if (!byMonth.has(month)) {
      byMonth.set(month, {
        infra_cost_eur: 0,
        infra_cost_inr: 0,
        infra_days_with_data: 0,
        infra_days_missing: 0,
        infra_days_failed: 0,
        providers_totals_eur: {},
        providers_totals_inr: {}
      });
    }
    const bucket = byMonth.get(month);
    if (
      row.infra_cost_eur != null &&
      (row.infra_status === 'ok' || row.infra_status === 'partial')
    ) {
      bucket.infra_cost_eur += row.infra_cost_eur;
      bucket.infra_cost_inr += row.infra_cost_inr || 0;
      bucket.infra_days_with_data += 1;
      for (const [pid, cost] of Object.entries(row.providers_cost_eur || {})) {
        bucket.providers_totals_eur[pid] = (bucket.providers_totals_eur[pid] || 0) + cost;
      }
      for (const [pid, cost] of Object.entries(row.providers_cost_inr || {})) {
        bucket.providers_totals_inr[pid] = (bucket.providers_totals_inr[pid] || 0) + (cost || 0);
      }
    } else if (row.infra_status === 'failed') {
      bucket.infra_days_failed += 1;
    } else {
      bucket.infra_days_missing += 1;
    }
  }
  return byMonth;
}

/**
 * Multi-cloud unit economics: sum enabled providers per day ÷ users (ClickHouse).
 */
async function getUnitEconomicsOverview(queryParams) {
  const tz = TimezoneService.normalizeTimezoneAlias(queryParams.tz || 'UTC');
  const startCal = TimezoneService.toCalendarYmd(queryParams.start_date);
  const endCal = TimezoneService.toCalendarYmd(queryParams.end_date);
  const { rangeStartUtc, rangeEndUtc } = TimezoneService.utcRangeForClientCalendar(
    startCal,
    endCal,
    tz
  );

  const fxTable = DEFAULT_FX_TO_EUR;
  const eurToInrRate = getEurToInrRate();
  const dateKeys = buildDateKeys(startCal, endCal, tz);
  const monthKeys = buildMonthKeys(startCal, endCal, tz);

  const [infraRows, activeUserRows, payingUserRows, monthlyActiveRows, monthlyPayingRows] =
    await Promise.all([
      AnalyticsModel.queryCloudInfraCostDailyByDateRange(startCal, endCal),
      AnalyticsModel.queryInfraCostDailyActiveUsers(rangeStartUtc, rangeEndUtc, tz),
      AnalyticsModel.queryInfraCostDailyPayingUsers(rangeStartUtc, rangeEndUtc, tz),
      AnalyticsModel.queryInfraCostMonthlyActiveUsers(rangeStartUtc, rangeEndUtc, tz),
      AnalyticsModel.queryInfraCostMonthlyPayingUsers(rangeStartUtc, rangeEndUtc, tz)
    ]);

  const infraByDate = groupInfraRowsByDate(infraRows, fxTable);
  const activeByDate = mapCountRows(activeUserRows, 'active_users');
  const payingByDate = mapCountRows(payingUserRows, 'paying_users');
  const activeByMonth = mapCountRows(monthlyActiveRows, 'active_users', 'month');
  const payingByMonth = mapCountRows(monthlyPayingRows, 'paying_users', 'month');

  let infraDaysWithData = 0;
  let infraDaysMissing = 0;
  let infraDaysFailed = 0;
  let infraDaysSkipped = 0;

  const dailySeries = dateKeys.map((date) => {
    const infra = infraByDate.get(date);
    const activeUsers = activeByDate.get(date) ?? 0;
    const payingUsers = payingByDate.get(date) ?? 0;

    let infraCostEur = null;
    let infraStatus = 'missing';
    const providers = {};
    const providersCostEur = {};

    if (infra) {
      infraStatus = infra.infra_status;
      if (infra.has_billable) {
        infraCostEur = infra.total_reporting;
        infraDaysWithData += 1;
      } else if (infraStatus === 'failed') {
        infraDaysFailed += 1;
      } else if (infraStatus === 'skipped') {
        infraDaysSkipped += 1;
      } else {
        infraDaysMissing += 1;
      }

      for (const [pid, pdata] of Object.entries(infra.providers)) {
        providers[pid] = pdata;
        if (pdata.cost_reporting != null && (pdata.status === 'ok' || pdata.status === 'partial')) {
          providersCostEur[pid] = pdata.cost_reporting;
        }
      }
    } else {
      infraDaysMissing += 1;
    }

    return enrichSeriesRowWithInr(
      {
        date,
        infra_cost_eur: infraCostEur,
        infra_status: infraStatus,
        reporting_currency: REPORTING_CURRENCY,
        resource_count: infra?.resource_count ?? 0,
        providers,
        providers_cost_eur: providersCostEur,
        active_users: activeUsers,
        paying_users_commerce: payingUsers,
        cost_per_active_user: roundRatio(safeDivide(infraCostEur, activeUsers)),
        cost_per_paying_user: roundRatio(safeDivide(infraCostEur, payingUsers))
      },
      eurToInrRate
    );
  });

  const dailyByMonth = aggregateMonthlyFromDaily(dailySeries);

  const monthlySeries = monthKeys.map((month) => {
    const daysInMonth = dateKeys.filter((d) => d.startsWith(month));
    const bucket = dailyByMonth.get(month) || {
      infra_cost_eur: 0,
      infra_cost_inr: 0,
      infra_days_with_data: 0,
      infra_days_missing: daysInMonth.length,
      infra_days_failed: 0,
      providers_totals_eur: {},
      providers_totals_inr: {}
    };
    const infraCostEur = roundMoney(bucket.infra_cost_eur);
    const infraCostInr = roundMoney(bucket.infra_cost_inr);
    const activeUsers = activeByMonth.get(month) ?? 0;
    const payingUsers = payingByMonth.get(month) ?? 0;

    return {
      month,
      infra_cost_eur: infraCostEur,
      infra_cost_inr: infraCostInr,
      infra_days_with_data: bucket.infra_days_with_data,
      infra_days_missing: bucket.infra_days_missing,
      infra_days_failed: bucket.infra_days_failed,
      providers_cost_eur: Object.fromEntries(
        Object.entries(bucket.providers_totals_eur).map(([k, v]) => [k, roundMoney(v)])
      ),
      providers_cost_inr: Object.fromEntries(
        Object.entries(bucket.providers_totals_inr).map(([k, v]) => [k, roundMoney(v)])
      ),
      active_users: activeUsers,
      paying_users_commerce: payingUsers,
      cost_per_active_user: roundRatio(safeDivide(infraCostEur, activeUsers)),
      cost_per_paying_user: roundRatio(safeDivide(infraCostEur, payingUsers)),
      cost_per_active_user_inr: roundRatio(safeDivide(infraCostInr, activeUsers)),
      cost_per_paying_user_inr: roundRatio(safeDivide(infraCostInr, payingUsers))
    };
  });

  return {
    timezone: tz,
    start_date: startCal,
    end_date: endCal,
    reporting_currency: REPORTING_CURRENCY,
    display_currency_default: 'INR',
    known_providers: KNOWN_PROVIDERS,
    fx_to_reporting: fxTable,
    fx_eur_to_inr: eurToInrRate,
    daily_series: dailySeries,
    monthly_series: monthlySeries,
    data_quality: {
      infra_days_with_data: infraDaysWithData,
      infra_days_missing: infraDaysMissing,
      infra_days_failed: infraDaysFailed,
      infra_days_skipped: infraDaysSkipped
    },
    definitions: {
      infra_cost_eur:
        'Sum of enabled cloud providers for the day, converted to EUR (reporting currency). Worker snapshot estimates — not invoices.',
      infra_cost_inr:
        'infra_cost_eur × fx_eur_to_inr for display. Configure rate via CLOUD_INFRA_FX_EUR_TO_INR on admin-api.',
      providers:
        'Per-provider from cloud_infra_cost_daily_stats spoke (Hub: infra_cost_snapshot events). cost_native is provider currency; cost_eur/inr for display.',
      storage:
        'Infra costs: workers → analytics_events_raw (Hub) → cloud_infra_cost_mv → cloud_infra_cost_daily_stats (Spoke). User counts: analytics_events_raw (Hub).',
      active_users:
        'Distinct user_id with any analytics_events_raw event that calendar day (client timezone).',
      paying_users_commerce:
        'Distinct user_id with purchase + commerce + revenue>0 that day (Growth metrics ARPPU cohort).',
      cost_per_active_user: 'infra_cost_eur / active_users when both available.',
      cost_per_paying_user: 'infra_cost_eur / paying_users_commerce when both available.'
    }
  };
}

module.exports = {
  getUnitEconomicsOverview
};

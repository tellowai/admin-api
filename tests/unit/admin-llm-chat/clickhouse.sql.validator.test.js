'use strict';

const { expect } = require('chai');
const { validateClickHouseSql } = require('../../../modules/admin-llm-chat/tools/clickhouse.sql.validator');

describe('clickhouse.sql.validator', () => {
  it('allows valid SELECT on whitelisted table with date filter', () => {
    const r = validateClickHouseSql(
      "SELECT campaign_name, spend FROM meta_ads_insights_daily WHERE date >= '2025-01-01' AND date <= '2025-01-07'",
    );
    expect(r.ok).to.equal(true);
    expect(r.sql).to.include('LIMIT');
  });

  it('allows UNION ALL period comparison on same whitelisted table', () => {
    const r = validateClickHouseSql(
      "SELECT 'current' AS period, currency, sum(total_revenue) AS revenue FROM revenue_daily_stats WHERE report_date BETWEEN '2026-05-23' AND '2026-05-29' GROUP BY currency UNION ALL SELECT 'prior' AS period, currency, sum(total_revenue) AS revenue FROM revenue_daily_stats WHERE report_date BETWEEN '2026-05-16' AND '2026-05-22' GROUP BY currency",
    );
    expect(r.ok).to.equal(true);
    expect(r.sql).to.include('UNION ALL');
    expect(r.tables).to.include('revenue_daily_stats');
  });

  it('rejects bare UNION without ALL', () => {
    const r = validateClickHouseSql(
      "SELECT 1 FROM revenue_daily_stats WHERE report_date >= '2026-05-01' UNION SELECT 2 FROM revenue_daily_stats WHERE report_date >= '2026-05-01'",
    );
    expect(r.ok).to.equal(false);
  });

  it('rejects JOIN', () => {
    const r = validateClickHouseSql(
      "SELECT * FROM meta_ads_insights_daily a JOIN google_ads_insights_daily b ON a.date = b.date WHERE a.date >= '2025-01-01'",
    );
    expect(r.ok).to.equal(false);
    expect(r.code).to.equal('JOIN_NOT_ALLOWED');
  });

  it('rejects INSERT', () => {
    const r = validateClickHouseSql("INSERT INTO meta_ads_insights_daily VALUES (1)");
    expect(r.ok).to.equal(false);
  });

  it('rejects non-whitelisted table', () => {
    const r = validateClickHouseSql(
      "SELECT * FROM secret_internal_table WHERE date >= '2025-01-01'",
    );
    expect(r.ok).to.equal(false);
    expect(r.code).to.equal('TABLE_NOT_ALLOWED');
  });

  it('rejects missing date predicate', () => {
    const r = validateClickHouseSql(
      "SELECT campaign_name FROM meta_ads_insights_daily WHERE campaign_id = '123'",
    );
    expect(r.ok).to.equal(false);
    expect(r.code).to.equal('DATE_PREDICATE_REQUIRED');
  });

  it('rejects unbounded min/max date discovery query', () => {
    const r = validateClickHouseSql(
      'SELECT max(date) AS latest_date, min(date) AS earliest_date, count(*) AS total_rows FROM meta_ads_insights_daily',
    );
    expect(r.ok).to.equal(false);
    expect(r.code).to.equal('DATE_PREDICATE_REQUIRED');
    expect(r.hint).to.include('get_table_date_bounds');
  });

  it('allows subquery wrapping a whitelisted table', () => {
    const r = validateClickHouseSql(
      "SELECT count() AS users_active FROM ( SELECT user_id, countDistinct(toDate(timestamp, 'Asia/Kolkata')) AS active_days FROM analytics_events_raw WHERE toDate(timestamp, 'Asia/Kolkata') >= '2026-05-16' AND toDate(timestamp, 'Asia/Kolkata') <= '2026-05-29' GROUP BY user_id HAVING active_days = 14 )",
    );
    expect(r.ok).to.equal(true);
    expect(r.tables).to.include('analytics_events_raw');
  });

  it('allows bounded date bounds aggregate query', () => {
    const r = validateClickHouseSql(
      "SELECT min(date) AS earliest_date, max(date) AS latest_date, count(*) AS row_count FROM meta_ads_insights_daily WHERE date >= '2024-01-01' AND date <= '2026-05-30'",
    );
    expect(r.ok).to.equal(true);
  });

  it('auto-fixes date column on report_date tables', () => {
    const r = validateClickHouseSql(
      "SELECT status, orders_count FROM orders_daily_stats WHERE date = '2026-05-19'",
    );
    expect(r.ok).to.equal(true);
    expect(r.sql).to.include('report_date');
    expect(r.sql).not.to.match(/\bWHERE\s+date\b/i);
  });

  it('auto-fixes date= without space on report_date tables', () => {
    const r = validateClickHouseSql(
      "SELECT * FROM attribution_daily_stats WHERE date='2026-05-19'",
    );
    expect(r.ok).to.equal(true);
    expect(r.sql).to.include('report_date');
    expect(r.sql).to.include('SELECT report_date');
  });

  it('allows report_date on orders_daily_stats', () => {
    const r = validateClickHouseSql(
      "SELECT status, sum(orders_count) AS orders FROM orders_daily_stats WHERE report_date = '2026-05-19' GROUP BY status",
    );
    expect(r.ok).to.equal(true);
  });

  it('rejects multiple statements', () => {
    const r = validateClickHouseSql("SELECT 1; DROP TABLE meta_ads_insights_daily");
    expect(r.ok).to.equal(false);
  });

  it('rewrites ILIKE to positionCaseInsensitive for contains patterns', () => {
    const r = validateClickHouseSql(
      "SELECT object_id FROM analytics_events_raw WHERE toDate(timestamp) >= '2026-04-23' AND toDate(timestamp) <= '2026-05-21' AND (event_name ILIKE '%order%' OR object_type ILIKE '%order%') ORDER BY timestamp DESC LIMIT 5",
    );
    expect(r.ok).to.equal(true);
    expect(r.sql).to.include("positionCaseInsensitive(event_name, 'order')");
    expect(r.sql).to.include("positionCaseInsensitive(object_type, 'order')");
    expect(r.sql).not.to.match(/\bILIKE\b/i);
  });

  it('allows order_created equality on analytics_events_raw', () => {
    const r = validateClickHouseSql(
      "SELECT timestamp, object_id FROM analytics_events_raw WHERE toDate(timestamp) >= '2026-04-23' AND toDate(timestamp) <= '2026-05-21' AND event_name = 'order_created' ORDER BY timestamp DESC LIMIT 5",
    );
    expect(r.ok).to.equal(true);
  });

  it('rewrites sum/uniq over AggregateFunction state columns to uniqMerge', () => {
    const r = validateClickHouseSql(
      "SELECT report_date, sum(orders_count) AS subs, sum(unique_users) AS uu FROM orders_daily_stats WHERE report_date = '2026-05-19' GROUP BY report_date",
    );
    expect(r.ok).to.equal(true);
    expect(r.sql).to.include('uniqMerge(unique_users)');
    expect(r.sql).to.include('sum(orders_count)');
    expect(r.sql).not.to.match(/sum\(unique_users\)/i);
  });

  it('rewrites uniq() shorthand over state columns', () => {
    const r = validateClickHouseSql(
      "SELECT uniq(unique_users) AS u FROM orders_daily_stats WHERE report_date = '2026-05-19'",
    );
    expect(r.ok).to.equal(true);
    expect(r.sql).to.include('uniqMerge(unique_users)');
  });

  it('rewrites ClickHouse zero-arg count() to count(*)', () => {
    const r = validateClickHouseSql(
      "SELECT toDate(timestamp) AS d, count() AS installs FROM analytics_events_raw WHERE toDate(timestamp) BETWEEN '2026-05-21' AND '2026-05-27' AND event_name = 'attributed_install' GROUP BY d ORDER BY d",
    );
    expect(r.ok).to.equal(true);
    expect(r.sql).to.include('count(*)');
    expect(r.sql).not.to.match(/\bcount\s*\(\s*\)/i);
  });

  it('falls back to regex table extraction when parser fails on CH-only syntax', () => {
    const r = validateClickHouseSql(
      "SELECT sumIf(spend, clicks > 0) AS s FROM meta_ads_insights_daily WHERE date = '2026-05-21'",
    );
    expect(r.ok).to.equal(true);
  });

  it('rewrites shadowed aggregate aliases for meta ads campaign query', () => {
    const sql = "SELECT campaign_id, any(campaign_name) AS campaign_name, currency, countDistinctIf(adset_id, spend > 0 OR impressions > 0) AS active_ad_sets, countDistinctIf(ad_id, spend > 0 OR impressions > 0) AS active_ad_creatives, sum(spend) AS spend, sum(impressions) AS impressions, sum(clicks) AS clicks FROM meta_ads_insights_daily WHERE date = '2026-05-21' GROUP BY campaign_id, currency HAVING spend > 0 OR impressions > 0 ORDER BY spend DESC";
    const r = validateClickHouseSql(sql);
    expect(r.ok).to.equal(true);
    expect(r.sql).to.include('sum(spend) AS agg_spend');
    expect(r.sql).to.include('sum(impressions) AS agg_impressions');
    expect(r.sql).to.include('countDistinctIf(adset_id, spend > 0 OR impressions > 0)');
    expect(r.sql).to.match(/HAVING\s+agg_spend\s*>\s*0/i);
    expect(r.sql).to.match(/ORDER BY\s+agg_spend\s+DESC/i);
    expect(r.sql).not.to.match(/\bAS\s+spend\b/i);
  });
});

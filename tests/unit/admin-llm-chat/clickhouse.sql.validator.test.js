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
});

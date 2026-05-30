'use strict';

const { expect } = require('chai');
const { buildDateBoundsSql } = require('../../../modules/admin-llm-chat/tools/clickhouse.tool');
const { validateClickHouseSql } = require('../../../modules/admin-llm-chat/tools/clickhouse.sql.validator');

describe('clickhouse date bounds', () => {
  it('builds bounded SQL for meta ads table', () => {
    const built = buildDateBoundsSql('meta_ads_insights_daily', {
      tz: 'Asia/Kolkata',
      lookbackDays: 30,
    });
    expect(built.sql).to.include('meta_ads_insights_daily');
    expect(built.sql).to.match(/WHERE\s+date\s*>=/i);
    expect(built.sql).to.match(/date\s*<=/i);
    const v = validateClickHouseSql(built.sql);
    expect(v.ok).to.equal(true);
  });

  it('builds bounded SQL for report_date tables', () => {
    const built = buildDateBoundsSql('orders_daily_stats', {
      tz: 'UTC',
      lookbackDays: 7,
    });
    expect(built.sql).to.include('report_date');
    const v = validateClickHouseSql(built.sql);
    expect(v.ok).to.equal(true);
  });

  it('builds bounded SQL for timestamp tables', () => {
    const built = buildDateBoundsSql('analytics_events_raw', {
      tz: 'UTC',
      lookbackDays: 14,
    });
    expect(built.sql).to.include('toDate(timestamp)');
    const v = validateClickHouseSql(built.sql);
    expect(v.ok).to.equal(true);
  });
});

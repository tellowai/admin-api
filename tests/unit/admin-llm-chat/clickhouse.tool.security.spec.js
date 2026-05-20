'use strict';

const { expect } = require('chai');
const { validateClickHouseSql } = require('../../../modules/admin-llm-chat/tools/clickhouse.sql.validator');

const ATTACKS = [
  ['DROP TABLE meta_ads_insights_daily', 'QUERY_NOT_ALLOWED'],
  ['SELECT * FROM meta_ads_insights_daily; DELETE FROM meta_ads_insights_daily WHERE date >= \'2025-01-01\'', 'QUERY_NOT_ALLOWED'],
  ['SELECT * FROM meta_ads_insights_daily a JOIN google_ads_insights_daily b ON a.date=b.date WHERE a.date >= \'2025-01-01\'', 'JOIN_NOT_ALLOWED'],
  ['INSERT INTO meta_ads_insights_daily SELECT 1', 'QUERY_NOT_ALLOWED'],
  ['SELECT * FROM system.tables WHERE date >= \'2025-01-01\'', 'TABLE_NOT_ALLOWED'],
  ['SELECT count() FROM meta_ads_insights_daily', 'DATE_PREDICATE_REQUIRED'],
  ['SELECT * FROM meta_ads_insights_daily WHERE date >= \'2025-01-01\' UNION SELECT * FROM secret', 'QUERY_NOT_ALLOWED'],
  ['SELECT * FROM meta_ads_insights_daily WHERE date >= \'2025-01-01\' INTO OUTFILE \'/tmp/x\'', 'QUERY_NOT_ALLOWED'],
  ['SELECT * FROM meta_ads_insights_daily WHERE date >= \'2025-01-01\' FORMAT CSV', 'QUERY_NOT_ALLOWED'],
  ['SELECT * FROM meta_ads_insights_daily WHERE date >= \'2025-01-01\' SETTINGS max_threads=128', 'QUERY_NOT_ALLOWED'],
];

describe('clickhouse.tool.security', () => {
  ATTACKS.forEach(([sql, expectedCode]) => {
    it(`blocks: ${sql.slice(0, 60)}…`, () => {
      const r = validateClickHouseSql(sql);
      expect(r.ok).to.equal(false);
      if (expectedCode) expect(r.code).to.equal(expectedCode);
    });
  });

  it('allows safe query with auto LIMIT', () => {
    const r = validateClickHouseSql(
      "SELECT campaign_name, sum(spend) FROM meta_ads_insights_daily WHERE date >= '2025-01-01' GROUP BY campaign_name",
    );
    expect(r.ok).to.equal(true);
    expect(r.sql).to.match(/LIMIT/i);
  });
});

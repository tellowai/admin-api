'use strict';

/**
 * Optional cross-table patterns for the LLM — hints only, not an exhaustive or mandatory map.
 */
const RELATIONSHIPS = {
  principles: [
    'SQL JOINs are disabled — use multiple query_clickhouse calls, then merge in analysis or run_analysis_code.',
    'Align time ranges when comparing tables (report_date, date, or toDate(timestamp) as appropriate).',
    'Use list_clickhouse_tables + get_table_schema to choose tables; do not limit yourself to the examples below.',
    'Prefer daily *_stats tables for rollups; try analytics_events_raw when you need event-level dimensions not in rollups.',
    'If one table or query path fails, explore other whitelisted tables before saying the question cannot be answered.',
  ],
  examples: [
    {
      topic: 'Image vs video / template type vs orders',
      tables: ['template_daily_stats', 'orders_daily_stats', 'analytics_events_raw'],
      note: 'Example only — output_type, product_classification, or raw event properties may help.',
    },
    {
      topic: 'Template usage vs AI cost',
      tables: ['template_daily_stats', 'ai_execution_daily_stats'],
      note: 'Often linked by template_id + date range.',
    },
    {
      topic: 'Ads spend vs downstream metrics',
      tables: ['meta_ads_insights_daily', 'google_ads_insights_daily', 'ga4_traffic_daily', 'attribution_daily_stats', 'revenue_daily_stats', 'auth_daily_stats'],
      note: 'Compare spend to installs/signups/revenue over the same dates; align meta/google date with ga4_traffic_daily.date; campaign names may not match exactly.',
    },
    {
      topic: 'GA4 traffic vs events vs web pages',
      tables: ['ga4_property_daily', 'ga4_traffic_daily', 'ga4_events_daily', 'ga4_pages_daily'],
      note: 'Property daily for DAU/sessions; traffic for channel breakdowns; events for event_name; pages for page_path.',
    },
    {
      topic: 'Commerce health',
      tables: ['orders_daily_stats', 'revenue_daily_stats', 'payment_failures_daily_stats'],
      note: 'Orders volume, revenue, and failure mix by date/currency.',
    },
    {
      topic: 'Credits vs engagement',
      tables: ['credits_daily_stats', 'template_daily_stats', 'pack_daily_stats'],
      note: 'Credit deductions vs template/pack activity.',
    },
    {
      topic: 'Attribution drill-down',
      tables: ['attribution_daily_stats', 'link_clicks', 'analytics_events_raw'],
      note: 'Rollups first; raw/click tables for detail.',
    },
  ],
};

function formatRelationshipsGuide() {
  const lines = [
    'Optional cross-table examples (hints only — explore freely with list_clickhouse_tables):',
    ...RELATIONSHIPS.principles.map((p) => `- ${p}`),
    '',
    'Example patterns (not exhaustive):',
    ...RELATIONSHIPS.examples.map((l) => (
      `- ${l.topic}: e.g. [${l.tables.join(', ')}]. ${l.note}`
    )),
  ];
  return lines.join('\n');
}

module.exports = {
  ...RELATIONSHIPS,
  formatRelationshipsGuide,
};

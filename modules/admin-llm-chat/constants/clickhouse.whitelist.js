'use strict';

/**
 * Whitelisted ClickHouse tables for admin LLM chat.
 * `required_date_column` must match the real partition/filter column in CH.
 * `columns` is the allow-list used for schema tool + query validation hints.
 */
module.exports = {
  analytics_events_raw: {
    required_date_column: 'timestamp',
    description: 'Raw product analytics events (hub). Filter with toDate(timestamp).',
    columns: [
      'timestamp', 'event_name', 'object_id', 'object_type', 'user_id', 'device_id',
      'app_version', 'build_number', 'os_name', 'os_version', 'device_brand', 'device_model',
      'screen_resolution', 'network_type', 'store_country', 'country', 'timezone', 'device_type',
      'revenue', 'properties',
    ],
    date_filter_example: "WHERE toDate(timestamp) = '2026-05-19'",
    pii_columns: ['user_id'],
  },
  link_clicks: {
    required_date_column: 'timestamp',
    description: 'Attribution link clicks. Filter with toDate(timestamp).',
    columns: [
      'timestamp', 'click_id', 'link_id', 'short_code', 'channel', 'source_name', 'campaign',
      'ip_address', 'user_agent', 'os', 'referrer_url', 'fingerprint', 'country', 'properties',
      'event_kind', 'attribution_provider', 'partner_click_id', 'session_id',
    ],
    date_filter_example: "WHERE toDate(timestamp) >= '2026-05-19' AND toDate(timestamp) <= '2026-05-19'",
    pii_columns: [],
  },
  attribution_daily_stats: {
    required_date_column: 'report_date',
    description: 'Daily attribution rollups by channel/campaign (SummingMergeTree).',
    columns: [
      'report_date', 'event_name', 'channel', 'source_name', 'campaign', 'attribution_method',
      'total_events', 'total_revenue',
    ],
    date_filter_example: "WHERE report_date = '2026-05-19'",
    aggregating: true,
    pii_columns: [],
  },
  auth_daily_stats: {
    required_date_column: 'report_date',
    description: 'Daily auth events (signup, login, etc.) by provider. Filter event_name as needed.',
    columns: [
      'report_date', 'event_name', 'provider', 'app_version', 'build_number', 'os_name', 'os_version',
      'device_brand', 'device_model', 'screen_resolution', 'network_type', 'store_country',
      'ip_country', 'timezone', 'total_events',
    ],
    date_filter_example: "WHERE report_date = '2026-05-19' AND event_name = 'signup'",
    aggregating: true,
    pii_columns: [],
  },
  revenue_daily_stats: {
    required_date_column: 'report_date',
    description: 'Daily commerce revenue (object_type commerce / purchase events).',
    columns: [
      'report_date', 'currency', 'payment_provider', 'plan_name', 'app_version', 'build_number',
      'os_name', 'os_version', 'device_brand', 'device_model', 'screen_resolution', 'network_type',
      'store_country', 'ip_country', 'timezone', 'total_purchases', 'total_revenue',
    ],
    date_filter_example: "WHERE report_date = '2026-05-19'",
    aggregating: true,
    pii_columns: [],
  },
  orders_daily_stats: {
    required_date_column: 'report_date',
    description: 'Daily order lifecycle counts (created/completed/failed).',
    columns: [
      'report_date', 'status', 'product_classification', 'payment_gateway', 'plan_type',
      'billing_interval', 'currency', 'store_country', 'ip_country', 'timezone',
      'orders_count', 'amount_total', 'unique_users',
    ],
    date_filter_example: "WHERE report_date = '2026-05-19'",
    aggregating: true,
    pii_columns: [],
  },
  payment_failures_daily_stats: {
    required_date_column: 'report_date',
    description: 'Daily payment failure/cancel rollups.',
    columns: [
      'report_date', 'event_name', 'failure_layer', 'failure_category', 'payment_gateway',
      'error_code', 'retryable', 'product_classification', 'plan_type', 'billing_interval', 'currency',
      'store_country', 'ip_country', 'timezone', 'app_version', 'os_name',
      'failure_count', 'unique_users', 'unique_devices', 'unique_correlations',
    ],
    date_filter_example: "WHERE report_date = '2026-05-19'",
    aggregating: true,
    pii_columns: [],
  },
  template_daily_stats: {
    required_date_column: 'report_date',
    description: 'Daily template views/tries/downloads/successes (one table for all template metrics).',
    columns: [
      'report_date', 'template_id', 'output_type', 'generation_type', 'app_version', 'build_number',
      'os_name', 'os_version', 'device_brand', 'device_model', 'screen_resolution', 'network_type',
      'store_country', 'ip_country', 'timezone', 'views', 'tries', 'downloads', 'successes', 'failures',
    ],
    date_filter_example: "WHERE report_date = '2026-05-19'",
    aggregating: true,
    pii_columns: [],
  },
  credits_daily_stats: {
    required_date_column: 'report_date',
    description: 'Daily credit ledger rollups.',
    columns: [
      'report_date', 'reason', 'country', 'issued', 'reserved', 'deducted', 'released',
      'users_receiving', 'users_spending',
    ],
    date_filter_example: "WHERE report_date = '2026-05-19'",
    aggregating: true,
    pii_columns: [],
  },
  ai_execution_daily_stats: {
    required_date_column: 'report_date',
    description: 'Daily AI model execution stats.',
    columns: [
      'report_date', 'template_id', 'model_name', 'provider_name', 'status', 'error_category',
      'total_executions', 'total_duration_ms', 'total_queue_ms', 'total_cost',
    ],
    date_filter_example: "WHERE report_date = '2026-05-19'",
    aggregating: true,
    pii_columns: [],
  },
  pack_daily_stats: {
    required_date_column: 'report_date',
    description: 'Daily pack unlock / engagement stats.',
    columns: [
      'report_date', 'event_name', 'pack_id', 'unlock_method', 'section_id', 'os_name',
      'store_country', 'event_count', 'unique_users', 'unique_devices',
    ],
    date_filter_example: "WHERE report_date = '2026-05-19'",
    aggregating: true,
    pii_columns: [],
  },
  meta_ads_insights_daily: {
    required_date_column: 'date',
    description: 'Meta Ads daily spend and performance.',
    columns: [
      'date', 'account_id', 'account_name', 'campaign_id', 'campaign_name', 'objective',
      'adset_id', 'adset_name', 'ad_id', 'ad_name', 'spend', 'impressions', 'clicks',
      'conversions', 'conversion_value', 'cpm', 'cpc', 'ctr', 'roas', 'currency', 'fetched_at',
    ],
    date_filter_example: "WHERE date = '2026-05-19'",
    pii_columns: [],
  },
  google_ads_insights_daily: {
    required_date_column: 'date',
    description: 'Google Ads daily spend and performance.',
    columns: [
      'date', 'customer_id', 'customer_name', 'campaign_id', 'campaign_name', 'ad_group_id', 'ad_group_name',
      'ad_id', 'ad_name', 'spend', 'impressions', 'clicks', 'interactions', 'conversions',
      'conversions_value', 'cpm', 'cpc', 'ctr', 'currency', 'fetched_at',
    ],
    date_filter_example: "WHERE date = '2026-05-19'",
    pii_columns: [],
  },
};

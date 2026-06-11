'use strict';

/**
 * Whitelisted ClickHouse tables for admin LLM chat.
 * `required_date_column` must match the real partition/filter column in CH.
 * `columns` is the allow-list used for schema tool + query validation hints.
 */
module.exports = {
  analytics_events_raw: {
    required_date_column: 'timestamp',
    description: 'Raw product analytics events (hub). Filter with toDate(timestamp). Use when daily stats lack a dimension.',
    related_tables: ['orders_daily_stats', 'template_daily_stats', 'attribution_daily_stats'],
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
  attribution_daily_stats_v2: {
    required_date_column: 'report_date',
    description: 'Daily attribution rollups by MMP channel_group (SummingMergeTree).',
    columns: [
      'report_date', 'event_name', 'attribution_class', 'channel_group', 'media_source', 'medium',
      'campaign', 'attribution_method', 'classification_version', 'total_events', 'total_revenue',
    ],
    date_filter_example: "WHERE report_date = '2026-05-19'",
    aggregating: true,
    pii_columns: [],
  },
  link_clicks_daily_stats: {
    required_date_column: 'report_date',
    description: 'Daily link click rollups by channel_group.',
    columns: [
      'report_date', 'attribution_class', 'channel_group', 'media_source', 'medium', 'campaign',
      'classification_version', 'total_clicks',
    ],
    date_filter_example: "WHERE report_date >= '2026-05-19'",
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
    description: 'Daily commerce revenue (object_type commerce / purchase events). Always GROUP BY currency when summing total_revenue — never report a bare number without currency.',
    currency_column: 'currency',
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
    description: 'Daily order lifecycle counts (created/completed/failed). Include currency when summing amount_total.',
    related_tables: ['template_daily_stats', 'revenue_daily_stats', 'analytics_events_raw'],
    currency_column: 'currency',
    columns: [
      'report_date', 'status', 'product_classification', 'payment_gateway', 'plan_type',
      'billing_interval', 'currency', 'store_country', 'ip_country', 'timezone',
      'orders_count', 'amount_total', 'unique_users',
    ],
    aggregate_state_columns: { unique_users: 'uniqMerge' },
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
    aggregate_state_columns: {
      unique_users: 'uniqMerge',
      unique_devices: 'uniqMerge',
      unique_correlations: 'uniqMerge',
    },
    date_filter_example: "WHERE report_date = '2026-05-19'",
    aggregating: true,
    pii_columns: [],
  },
  template_daily_stats: {
    required_date_column: 'report_date',
    description: 'Daily template views/tries/downloads/successes (one table for all template metrics). output_type distinguishes image vs video.',
    related_tables: ['orders_daily_stats', 'ai_execution_daily_stats', 'analytics_events_raw'],
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
    aggregate_state_columns: {
      users_receiving: 'uniqMerge',
      users_spending: 'uniqMerge',
    },
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
    aggregate_state_columns: {
      unique_users: 'uniqMerge',
      unique_devices: 'uniqMerge',
    },
    date_filter_example: "WHERE report_date = '2026-05-19'",
    aggregating: true,
    pii_columns: [],
  },
  meta_ads_insights_daily: {
    required_date_column: 'date',
    description: 'Meta Ads daily spend and performance. Include currency when reporting spend.',
    currency_column: 'currency',
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
    description: 'Google Ads daily spend and performance. Include currency when reporting spend.',
    currency_column: 'currency',
    columns: [
      'date', 'customer_id', 'customer_name', 'campaign_id', 'campaign_name', 'ad_group_id', 'ad_group_name',
      'ad_id', 'ad_name', 'spend', 'impressions', 'clicks', 'interactions', 'conversions',
      'conversions_value', 'cpm', 'cpc', 'ctr', 'currency', 'fetched_at',
    ],
    date_filter_example: "WHERE date = '2026-05-19'",
    pii_columns: [],
  },
  ga4_property_daily: {
    required_date_column: 'date',
    description: 'GA4 property-level daily metrics. Use for DAU (active_users per day), WAU/MAU (sum active_users over days is approximate; prefer stating daily series). One row per date per property_id.',
    columns: [
      'date', 'property_id', 'sessions', 'active_users', 'new_users', 'engaged_sessions',
      'engagement_rate', 'average_session_duration', 'conversions', 'total_revenue', 'fetched_at',
    ],
    date_filter_example: "WHERE date = '2026-05-19'",
    pii_columns: [],
  },
  ga4_traffic_daily: {
    required_date_column: 'date',
    description: 'GA4 traffic and acquisition by channel/source (do not sum active_users across rows for DAU — use ga4_property_daily).',
    columns: [
      'date', 'property_id', 'session_default_channel_group', 'session_source', 'session_medium',
      'session_campaign_name', 'country', 'platform', 'device_category', 'sessions', 'active_users',
      'new_users', 'engaged_sessions', 'engagement_rate', 'average_session_duration', 'conversions',
      'total_revenue', 'fetched_at',
    ],
    date_filter_example: "WHERE date = '2026-05-19'",
    pii_columns: [],
  },
  ga4_events_daily: {
    required_date_column: 'date',
    description: 'GA4 event counts by event_name (web/app Firebase stream). Use for GA event trends and funnels; filter event_name.',
    columns: [
      'date', 'property_id', 'event_name', 'platform', 'country', 'event_count', 'active_users',
      'event_value', 'fetched_at',
    ],
    date_filter_example: "WHERE date = '2026-05-19' AND event_name = 'screen_view'",
    pii_columns: [],
  },
  ga4_pages_daily: {
    required_date_column: 'date',
    description: 'GA4 web page performance (page_path, page_title).',
    columns: [
      'date', 'property_id', 'page_path', 'page_title', 'host_name', 'screen_page_views',
      'active_users', 'average_session_duration', 'fetched_at',
    ],
    date_filter_example: "WHERE date = '2026-05-19'",
    pii_columns: [],
  },
};

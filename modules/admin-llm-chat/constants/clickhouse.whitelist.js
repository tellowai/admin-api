'use strict';

module.exports = {
  analytics_events_raw: {
    required_date_column: 'timestamp',
    description: 'Raw product analytics events',
    pii_columns: ['user_id'],
  },
  link_clicks: {
    required_date_column: 'clicked_at',
    description: 'Attribution link clicks',
    pii_columns: [],
  },
  attribution_daily_stats: {
    required_date_column: 'date',
    description: 'Daily attribution rollups',
    pii_columns: [],
  },
  signups_daily: {
    required_date_column: 'date',
    description: 'Daily signups',
    pii_columns: [],
  },
  login_daily: {
    required_date_column: 'date',
    description: 'Daily logins',
    pii_columns: [],
  },
  purchases_daily: {
    required_date_column: 'date',
    description: 'Daily purchases',
    pii_columns: [],
  },
  revenue_daily_stats: {
    required_date_column: 'date',
    description: 'Daily revenue',
    pii_columns: [],
  },
  orders_daily_stats: {
    required_date_column: 'date',
    description: 'Daily orders',
    pii_columns: [],
  },
  payment_failures_daily_stats: {
    required_date_column: 'date',
    description: 'Daily payment failures',
    pii_columns: [],
  },
  template_views_daily: {
    required_date_column: 'date',
    description: 'Template views daily',
    pii_columns: [],
  },
  template_tries_daily: {
    required_date_column: 'date',
    description: 'Template tries daily',
    pii_columns: [],
  },
  template_downloads_daily: {
    required_date_column: 'date',
    description: 'Template downloads daily',
    pii_columns: [],
  },
  credits_daily_stats: {
    required_date_column: 'date',
    description: 'Credits usage daily',
    pii_columns: [],
  },
  ai_execution_daily_stats: {
    required_date_column: 'date',
    description: 'AI execution costs daily',
    pii_columns: [],
  },
  pack_daily_stats: {
    required_date_column: 'date',
    description: 'Pack stats daily',
    pii_columns: [],
  },
  meta_ads_insights_daily: {
    required_date_column: 'date',
    description: 'Meta Ads daily spend and performance',
    pii_columns: [],
  },
  google_ads_insights_daily: {
    required_date_column: 'date',
    description: 'Google Ads daily spend and performance',
    pii_columns: [],
  },
};

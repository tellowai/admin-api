'use strict';

/**
 * Column names whose row VALUES are redacted before tool results reach the LLM,
 * the UI, or persistence. Every entry below was verified against the actual DB
 * migrations (photobop-db-migrations) — source table noted in comments.
 *
 * Free-text PII (e.g. an email inside a JSON/text column) is additionally
 * caught by the regex pass in pii.redactor.js, so this list only needs the
 * direct identifier/secret columns. Generic columns that are NOT PII
 * (name/display_name/username on templates, fonts, sdui nodes; gender; country)
 * are intentionally excluded so aggregate/group-by analysis still works.
 * Matching is case-insensitive on the exact column name.
 */
const PII_COLUMNS = new Set([
  // Contact / identity — `user`, `user_secondary_email`
  'email',
  'email_verification_token',
  'mobile',
  'first_name',
  'middle_name',
  'last_name',
  'profile_pic',
  'profile_pic_bucket',
  'profile_pic_asset_key',
  'dob',

  // Credentials / secrets — `user`
  'password',
  'password_salt',

  // Device / push — `user_notification_subscription`
  'push_token',
  'fcm_token',

  // Device / network — `user_login_history`, `user_policy_consents`,
  // attribution snapshots, `photo_booth_generations`, `media_generations`,
  // `claimed_templates`, CH analytics_events_raw / link_clicks / payment_order_attempts
  'device_id',
  'ip_address',
  'user_agent',

  // Payment / external transaction tokens — `orders`, `payment_orphan_events`
  'apple_app_account_token',
  'external_transaction_token',
  'external_transaction_id',
  'signed_transaction_info',
]);

module.exports = { PII_COLUMNS };

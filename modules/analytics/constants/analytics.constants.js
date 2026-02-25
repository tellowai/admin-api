"use strict";

const ANALYTICS_CONSTANTS = {
  TABLES: {
    // Raw tables
    CHARACTER_CREATIONS: "character_creations",
    CHARACTER_TRAININGS: "character_trainings",
    TEMPLATE_VIEWS: "template_views",
    TEMPLATE_TRIES: "template_tries",
    TEMPLATE_DOWNLOADS: "template_downloads",
    SIGNUPS: "signup",
    LOGINS: "login",
    PURCHASES: "purchases",

    // Daily summary tables (single table per domain; no hourly/monthly)
    TEMPLATE_VIEWS_DAILY: "template_views_daily_summary",
    TEMPLATE_TRIES_DAILY: "template_tries_daily_summary",
    TEMPLATE_DOWNLOADS_DAILY: "template_downloads_daily_summary",
    CHARACTER_CREATIONS_DAILY: "character_creations_daily_summary",
    CHARACTER_TRAININGS_DAILY: "character_trainings_daily_summary",
    SIGNUPS_DAILY: "signup_daily_summary",
    LOGINS_DAILY: "login_daily_summary",
    PURCHASES_DAILY: "purchases_daily_summary",

    // Materialized view target tables (daily only)
    AUTH_DAILY_STATS: "auth_daily_stats",
    REVENUE_DAILY_STATS: "revenue_daily_stats",
    TEMPLATE_DAILY_STATS: "template_daily_stats",
    CREDITS_DAILY_STATS: "credits_daily_stats",
    ANALYTICS_EVENTS_RAW: "analytics_events_raw",
    AI_EXECUTION_DAILY_STATS: "ai_execution_daily_stats",
    AE_RENDERING_DAILY_STATS: "ae_rendering_daily_stats",
  },
  // Event names in auth_daily_stats
  AUTH_EVENT_NAMES: {
    SIGNUP: "signup",
    LOGIN: "login",
  },
  // Template measure columns in template_daily_stats
  TEMPLATE_MEASURES: {
    VIEWS: "views",
    TRIES: "tries",
    DOWNLOADS: "downloads",
    SUCCESSES: "successes",
    FAILURES: "failures",
  },
  // Allowed group_by columns per domain (for MV tables)
  AUTH_GROUP_BY_COLUMNS: ["provider"],
  REVENUE_GROUP_BY_COLUMNS: ["currency", "payment_provider", "plan_name"],
  TEMPLATE_GROUP_BY_COLUMNS: ["output_type", "generation_type"],
  CREDITS_GROUP_BY_COLUMNS: ["reason", "country"],
  GENDER_ENUMS: {
    MALE: "male",
    FEMALE: "female",
    COUPLE: "couple",
    UNKNOWN: "unknown",
  },
  OUTPUT_TYPE_ENUMS: {
    IMAGE: "image",
    VIDEO: "video",
    AUDIO: "audio",
    PDF: "pdf",
    WEBSITE: "website",
    UNKNOWN: "unknown",
  },
  ASPECT_RATIO_ENUMS: {
    "9:16": "9:16",
    "16:9": "16:9",
    "3:4": "3:4",
    "4:3": "4:3",
    "1:1": "1:1",
    UNKNOWN: "unknown",
  },
  ORIENTATION_ENUMS: {
    HORIZONTAL: "horizontal",
    VERTICAL: "vertical",
    UNKNOWN: "unknown",
  },
  GENERATION_TYPE_ENUMS: {
    AI: "ai",
    NON_AI: "non-ai",
    UNKNOWN: "unknown",
  },
  PROVIDER_ENUMS: {
    GOOGLE: "google",
    FACEBOOK: "facebook",
    TRUECALLER: "truecaller",
    OTP: "otp",
    OTP_MOBILE: "otp_mobile",
    OTP_EMAIL: "otp_email",
    UNKNOWN: "unknown",
  },
  PAYMENT_PROVIDER_ENUMS: {
    RAZORPAY: "razorpay",
    STRIPE: "stripe",
    PAYPAL: "paypal",
    GOOGLE_PAY: "google_pay",
    APPLE_PAY: "apple_pay",
    UPI: "upi",
    CARD: "card",
    NET_BANKING: "net_banking",
    WALLET: "wallet",
    UNKNOWN: "unknown",
  },
  PLAN_TYPE_ENUMS: {
    SUBSCRIPTION: "subscription",
    ONE_TIME: "one-time",
    UNKNOWN: "unknown",
  },
  CURRENCY_ENUMS: {
    INR: "INR",
    USD: "USD",
    UNKNOWN: "unknown",
  },
  ERRORS: {
    INVALID_DATE_RANGE: "INVALID_DATE_RANGE",
    INVALID_DATE_FORMAT: "INVALID_DATE_FORMAT",
    MISSING_DATE_PARAMETERS: "MISSING_DATE_PARAMETERS",
    ANALYTICS_QUERY_FAILED: "ANALYTICS_QUERY_FAILED",
  },
};

module.exports = ANALYTICS_CONSTANTS;

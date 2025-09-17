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

    // Summary tables for better performance
    TEMPLATE_VIEWS_HOURLY: "template_views_hourly_summary",
    TEMPLATE_VIEWS_DAILY: "template_views_daily_summary",
    TEMPLATE_VIEWS_MONTHLY: "template_views_monthly_summary",

    TEMPLATE_TRIES_HOURLY: "template_tries_hourly_summary",
    TEMPLATE_TRIES_DAILY: "template_tries_daily_summary",
    TEMPLATE_TRIES_MONTHLY: "template_tries_monthly_summary",

    TEMPLATE_DOWNLOADS_HOURLY: "template_downloads_hourly_summary",
    TEMPLATE_DOWNLOADS_DAILY: "template_downloads_daily_summary",
    TEMPLATE_DOWNLOADS_MONTHLY: "template_downloads_monthly_summary",

    CHARACTER_CREATIONS_HOURLY: "character_creations_hourly_summary",
    CHARACTER_CREATIONS_DAILY: "character_creations_daily_summary",
    CHARACTER_CREATIONS_MONTHLY: "character_creations_monthly_summary",

    CHARACTER_TRAININGS_HOURLY: "character_trainings_hourly_summary",
    CHARACTER_TRAININGS_DAILY: "character_trainings_daily_summary",
    CHARACTER_TRAININGS_MONTHLY: "character_trainings_monthly_summary",

    SIGNUPS_HOURLY: "signup_hourly_summary",
    SIGNUPS_DAILY: "signup_daily_summary",
    SIGNUPS_MONTHLY: "signup_monthly_summary",

    LOGINS_HOURLY: "login_hourly_summary",
    LOGINS_DAILY: "login_daily_summary",
    LOGINS_MONTHLY: "login_monthly_summary",
  },
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
  ERRORS: {
    INVALID_DATE_RANGE: "INVALID_DATE_RANGE",
    INVALID_DATE_FORMAT: "INVALID_DATE_FORMAT",
    MISSING_DATE_PARAMETERS: "MISSING_DATE_PARAMETERS",
    ANALYTICS_QUERY_FAILED: "ANALYTICS_QUERY_FAILED",
  },
};

module.exports = ANALYTICS_CONSTANTS;

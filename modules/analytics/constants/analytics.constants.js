'use strict';

const ANALYTICS_CONSTANTS = {
  TABLES: {
    CHARACTER_CREATIONS: 'character_creations',
    CHARACTER_TRAININGS: 'character_trainings',
    TEMPLATE_VIEWS: 'template_views',
    TEMPLATE_TRIES: 'template_tries',
    TEMPLATE_DOWNLOADS: 'template_downloads'
  },
  GENDER_ENUMS: {
    MALE: 'male',
    FEMALE: 'female',
    COUPLE: 'couple',
    UNKNOWN: 'unknown'
  },
  OUTPUT_TYPE_ENUMS: {
    IMAGE: 'image',
    VIDEO: 'video',
    AUDIO: 'audio',
    PDF: 'pdf',
    WEBSITE: 'website',
    UNKNOWN: 'unknown'
  },
  ASPECT_RATIO_ENUMS: {
    '9:16': '9:16',
    '16:9': '16:9',
    '3:4': '3:4',
    '4:3': '4:3',
    '1:1': '1:1',
    UNKNOWN: 'unknown'
  },
  ORIENTATION_ENUMS: {
    HORIZONTAL: 'horizontal',
    VERTICAL: 'vertical',
    UNKNOWN: 'unknown'
  },
  GENERATION_TYPE_ENUMS: {
    AI: 'ai',
    NON_AI: 'non-ai',
    UNKNOWN: 'unknown'
  },
  ERRORS: {
    INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
    INVALID_DATE_FORMAT: 'INVALID_DATE_FORMAT',
    MISSING_DATE_PARAMETERS: 'MISSING_DATE_PARAMETERS',
    ANALYTICS_QUERY_FAILED: 'ANALYTICS_QUERY_FAILED'
  }
};

module.exports = ANALYTICS_CONSTANTS;

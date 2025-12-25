'use strict';

/**
 * Template-related constants
 */
module.exports = {
  // Dollar value per single credit
  USD_PER_CREDIT: 0.02,
  // Fallback USD for a single model invocation when costs are missing/unknown
  DEFAULT_MODEL_INVOCATION_USD: 0.02,
  // Non-AI template base prices
  NON_AI_IMAGE_BASE_CREDITS: 1,
  NON_AI_VIDEO_BASE_CREDITS: 50,
  // Heuristics for estimating resource usage
  DEFAULT_IMAGE_MEGAPIXELS: 1,
  DEFAULT_VIDEO_SEGMENT_SECONDS: 5
};



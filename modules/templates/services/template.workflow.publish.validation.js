'use strict';

/**
 * Mirrors photobop-workers/modules/workflows-v2/utils/workflow.utils.js
 * validateAETemplateAssets + resolveWorkflowScenario (publish = structural checks only).
 */

const VIDEO_TRANSPARENT_WEBM_LAYER_TYPE = 'video_transparent_webm';
const VALID_WORKFLOW_TYPES = ['AE_ONLY', 'AI_ONLY', 'AI_PLUS_AE'];

function _parseAdditionalData(template) {
  let additionalData = template?.additional_data;
  if (additionalData && typeof additionalData === 'string') {
    try {
      additionalData = JSON.parse(additionalData);
    } catch {
      additionalData = null;
    }
  }
  return additionalData;
}

function _getSceneWebmLayer(scene) {
  const layers = scene?.layers || [];
  return layers.find((l) => {
    const layerType = l.type || l.layer_type;
    const hasKey = l.asset_key != null && String(l.asset_key).trim() !== '';
    const hasBucket = l.asset_bucket != null && String(l.asset_bucket).trim() !== '';
    return layerType === VIDEO_TRANSPARENT_WEBM_LAYER_TYPE && hasKey && hasBucket;
  }) || null;
}

function _nonEmpty(v) {
  return v != null && String(v).trim() !== '';
}

/**
 * Same rules as WorkflowUtils.validateAETemplateAssets (workers).
 * @param {Object} template — row + scenes from getTemplateById
 * @returns {boolean}
 */
function validateAETemplateAssets(template) {
  if (!template) return false;

  const additionalData = _parseAdditionalData(template);
  const templateView = { ...template, additional_data: additionalData };

  const hasBodymovinJson = !!(templateView.bodymovin_json_key && templateView.bodymovin_json_bucket);
  const hasColorVideo = !!(templateView.color_video_key && templateView.color_video_bucket);
  const hasMaskVideo = !!(templateView.mask_video_key && templateView.mask_video_bucket);
  const hasAlphaMaskAssets = hasBodymovinJson && hasColorVideo && hasMaskVideo;

  const isTransparentWebmEngine =
    templateView.ae_rendering_engine === 'transparent_webm' ||
    (additionalData && additionalData.transparent_webm_mode);
  const hasScenes = templateView.scenes && Array.isArray(templateView.scenes) && templateView.scenes.length > 0;

  if (isTransparentWebmEngine) {
    if (hasScenes) {
      let allScenesHaveWebm = true;
      for (const scene of templateView.scenes) {
        if (!_getSceneWebmLayer(scene)) {
          allScenesHaveWebm = false;
          break;
        }
      }
      if (allScenesHaveWebm && hasBodymovinJson) return true;
    }
    if (hasAlphaMaskAssets) return true;
    if (hasBodymovinJson) return true;
    return false;
  }

  return hasAlphaMaskAssets;
}

/**
 * What to fix for AE (when validateAETemplateAssets is false).
 * @param {Object} template
 * @param {function} t — req.t
 * @returns {string[]}
 */
function getAETemplateAssetGapMessages(template, t) {
  if (!template || validateAETemplateAssets(template)) return [];

  const additionalData = _parseAdditionalData(template);
  const isTransparentWebm =
    template.ae_rendering_engine === 'transparent_webm' ||
    (additionalData && additionalData.transparent_webm_mode);

  const hasBodymovin = _nonEmpty(template.bodymovin_json_key) && _nonEmpty(template.bodymovin_json_bucket);
  const hasColor = _nonEmpty(template.color_video_key) && _nonEmpty(template.color_video_bucket);
  const hasMask = _nonEmpty(template.mask_video_key) && _nonEmpty(template.mask_video_bucket);

  if (isTransparentWebm) {
    if (!hasBodymovin) {
      return [t('template:PUBLISH_ERROR_AE_DETAIL_BODYMOVIN')];
    }
    return [t('template:PUBLISH_ERROR_AE_ASSETS_INCOMPLETE_GENERIC')];
  }

  const messages = [];
  if (!hasBodymovin) messages.push(t('template:PUBLISH_ERROR_AE_DETAIL_BODYMOVIN'));
  if (!hasColor) messages.push(t('template:PUBLISH_ERROR_AE_DETAIL_COLOR'));
  if (!hasMask) messages.push(t('template:PUBLISH_ERROR_AE_DETAIL_MASK'));
  return messages;
}

/**
 * Same outcomes as WorkflowUtils.resolveWorkflowScenario (granular publish errors).
 * @param {string|undefined} workflowType
 * @param {boolean} hasAIClips
 * @param {boolean} hasAEAssets
 * @param {function} t
 * @param {{ templateClipsAssetsType?: string, aeGapMessages?: string[] }} [options]
 * @returns {string[]}
 */
function resolveWorkflowScenarioPublishErrors(workflowType, hasAIClips, hasAEAssets, t, options = {}) {
  const { templateClipsAssetsType = '', aeGapMessages = [] } = options;
  const errors = [];

  const pushAeGaps = (fallbackKey = 'template:PUBLISH_ERROR_AE_ASSETS_INCOMPLETE_GENERIC') => {
    if (aeGapMessages.length > 0) {
      errors.push(...aeGapMessages);
    } else if (!hasAEAssets) {
      errors.push(t(fallbackKey));
    }
  };

  if (workflowType && VALID_WORKFLOW_TYPES.includes(workflowType)) {
    if (workflowType === 'AE_ONLY') {
      if (!hasAEAssets) pushAeGaps('template:PUBLISH_ERROR_AE_ONLY_NO_ASSETS');
    }
    if (workflowType === 'AI_ONLY') {
      if (!hasAIClips) errors.push(t('template:PUBLISH_ERROR_AI_ONLY_NO_CLIPS'));
    }
    if (workflowType === 'AI_PLUS_AE') {
      if (!hasAIClips) {
        const isNonAi = String(templateClipsAssetsType).toLowerCase() === 'non-ai';
        errors.push(
          isNonAi
            ? t('template:PUBLISH_ERROR_AI_PLUS_AE_WITH_NON_AI_TYPE')
            : t('template:PUBLISH_ERROR_AI_PLUS_AE_MISSING_CLIPS')
        );
      }
      if (!hasAEAssets) pushAeGaps('template:PUBLISH_ERROR_AE_ASSETS_INCOMPLETE_GENERIC');
    }
    return errors;
  }

  if (!hasAIClips && !hasAEAssets) {
    pushAeGaps();
    errors.push(t('template:PUBLISH_ERROR_NO_AI_OR_AE'));
  }
  return errors;
}

module.exports = {
  validateAETemplateAssets,
  getAETemplateAssetGapMessages,
  resolveWorkflowScenarioPublishErrors,
  VALID_WORKFLOW_TYPES
};

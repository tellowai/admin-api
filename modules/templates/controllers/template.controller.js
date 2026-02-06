'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const TemplateModel = require('../models/template.model');
const TemplateTagDefinitionModel = require('../models/template.tag.definition.model');
const TemplateTagFacetModel = require('../models/template.tag.facet.model');
const TemplateTagsModel = require('../models/template.tags.model');
const TemplateErrorHandler = require('../middlewares/template.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const StorageFactory = require('../../os2/providers/storage.factory');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const TEMPLATE_CONSTANTS = require('../constants/template.constants');
const { v7: uuidv7 } = require('uuid');
const config = require('../../../config/config');
const axios = require('axios');
const AiModelModel = require('../../ai-models/models/ai-model.model');
const TemplateRedisService = require('../services/template.redis.service');
const NicheModel = require('../../niches/models/niche.model');
const NicheDataFieldDefinitionModel = require('../../niches/models/niche.data.field.definition.model');
const WorkflowModel = require('../../workflow-builder/models/workflow.model');

// Timeout for reading Bodymovin JSON (in milliseconds)
const BODYMOVIN_FETCH_TIMEOUT_MS = 10000;

/**
 * Read Bodymovin (Lottie) JSON from storage or from URL.
 * Uses StorageFactory when key is a storage key; uses axios when key is a full http(s) URL.
 * @param {Object} storage - Storage provider from StorageFactory.getProvider()
 * @param {string} bucket - Bucket name or alias ('public', 'private')
 * @param {string} key - Object key, or full URL (http/https)
 * @returns {Promise<Object|null>} Parsed Bodymovin JSON or null on failure
 */
async function getBodymovinJson(storage, bucket, key) {
  try {
    if (/^https?:\/\//i.test(key)) {
      const response = await axios.get(key, {
        timeout: BODYMOVIN_FETCH_TIMEOUT_MS,
        responseType: 'json',
        validateStatus: (status) => status === 200
      });
      return response.data || null;
    }
    const bodyString = await storage.getObjectBodyFromBucket(bucket, key);
    return bodyString ? JSON.parse(bodyString) : null;
  } catch (error) {
    logger.warn('Failed to read Bodymovin JSON', { bucket, key, error: error.message });
    return null;
  }
}

/**
 * Fetch Bodymovin JSON and extract width and height (for callers that pass URL)
 * @param {string} bodymovinUrl - URL to the Bodymovin JSON file
 * @returns {Object} - Object containing width and height, or null if failed
 */
async function fetchBodymovinDimensions(bodymovinUrl) {
  try {
    const response = await axios.get(bodymovinUrl, {
      timeout: BODYMOVIN_FETCH_TIMEOUT_MS,
      responseType: 'json',
      validateStatus: (status) => status === 200
    });
    const bodymovinJson = response.data;
    if (!bodymovinJson) return null;
    const width = bodymovinJson.w;
    const height = bodymovinJson.h;
    if (!width || !height) {
      logger.warn('Bodymovin JSON missing width or height', { url: bodymovinUrl, width, height });
      return null;
    }
    return { width, height };
  } catch (error) {
    logger.error('Error fetching Bodymovin JSON dimensions', { url: bodymovinUrl, error: error.message });
    return null;
  }
}

/**
 * Calculate aspect ratio and determine orientation from width and height
 * @param {number} width - Width of the video
 * @param {number} height - Height of the video
 * @returns {Object} - Object containing aspect ratio and orientation
 */
function calculateAspectRatioAndOrientation(width, height) {
  if (!width || !height || width <= 0 || height <= 0) {
    return { aspectRatio: null, orientation: null };
  }

  const ratio = width / height;

  // Determine aspect ratio
  let aspectRatio;
  if (Math.abs(ratio - 1) < 0.01) {
    aspectRatio = '1:1';
  } else if (Math.abs(ratio - 0.75) < 0.01) {
    aspectRatio = '3:4';
  } else if (Math.abs(ratio - 1.33) < 0.01) {
    aspectRatio = '4:3';
  } else if (Math.abs(ratio - 0.5625) < 0.01) {
    aspectRatio = '9:16';
  } else if (Math.abs(ratio - 1.78) < 0.01) {
    aspectRatio = '16:9';
  } else {
    // For other ratios, find the closest match
    const ratios = [
      { value: 1, name: '1:1' },
      { value: 0.75, name: '3:4' },
      { value: 1.33, name: '4:3' },
      { value: 0.5625, name: '9:16' },
      { value: 1.78, name: '16:9' }
    ];

    const closest = ratios.reduce((prev, curr) =>
      Math.abs(curr.value - ratio) < Math.abs(prev.value - ratio) ? curr : prev
    );
    aspectRatio = closest.name;
  }

  // Determine orientation
  let orientation;
  if (aspectRatio === '1:1') {
    orientation = 'square';
  } else if (width > height) {
    orientation = 'horizontal';
  } else {
    orientation = 'vertical';
  }

  return { aspectRatio, orientation };
}

/**
 * Extract asset types from template clips
 * @param {Array} clips - Array of template clips
 * @returns {Array} - Array of unique asset types
 */
function extractAssetTypesFromClips(clips) {
  if (!clips || !Array.isArray(clips) || clips.length === 0) {
    return [];
  }

  const assetTypes = new Set();

  clips.forEach(clip => {
    if (clip && clip.asset_type) {
      assetTypes.add(clip.asset_type);
    }
  });

  return Array.from(assetTypes);
}

/**
 * Convert special characters to underscores for tag_code
 * @param {string} code - Tag code to convert
 * @returns {string} - Converted code with colons and hyphens replaced by underscores
 */
function convertSpecialCharsToUnderscore(code) {
  // Convert colons and hyphens to underscores: 3:4 -> 3_4, non-ai -> non_ai
  return code.replace(/[:]/g, '_').replace(/-/g, '_');
}


/**
 * Get template tags with full tag definition details from pre-fetched data
 * @param {string} templateId - Template ID
 * @param {Map} templateTagsMap - Pre-fetched template tags map
 * @param {Map} tagDefinitionMap - Pre-fetched tag definitions map
 * @returns {Array} - Array of tags with full details
 */
function getTemplateTagsWithDetailsFromPrefetched(templateId, templateTagsMap, tagDefinitionMap) {
  const templateTags = templateTagsMap.get(templateId) || [];

  if (templateTags.length === 0) {
    return [];
  }

  // Stitch the data together using pre-fetched maps
  const tagsWithDetails = templateTags.map(tt => {
    const tagDefinition = tagDefinitionMap.get(tt.ttd_id);
    return {
      tt_id: tt.tt_id,
      template_id: tt.template_id,
      ttd_id: tt.ttd_id,
      facet_id: tt.facet_id,
      tag_name: tagDefinition ? tagDefinition.tag_name : null,
      tag_code: tagDefinition ? tagDefinition.tag_code : null,
      tag_description: tagDefinition ? tagDefinition.tag_description : null,
      is_active: tagDefinition ? tagDefinition.is_active : null,
      created_at: tt.created_at,
      updated_at: tt.updated_at
    };
  });

  return tagsWithDetails;
}

/**
 * Get template tags with full tag definition details
 * @param {string} templateId - Template ID
 * @returns {Array} - Array of tags with full details
 */
async function getTemplateTagsWithDetails(templateId) {
  try {
    // Get template tags (just the relationships)
    const templateTags = await TemplateTagsModel.getTemplateTags(templateId);

    if (templateTags.length === 0) {
      return [];
    }

    // Get tag definition IDs
    const tagDefinitionIds = templateTags.map(tt => tt.ttd_id);

    // Get tag definitions
    const tagDefinitions = await TemplateTagDefinitionModel.getTagDefinitionsByIds(tagDefinitionIds);

    // Create a map for quick lookup
    const tagDefinitionMap = new Map();
    tagDefinitions.forEach(td => {
      tagDefinitionMap.set(td.ttd_id, td);
    });

    // Stitch the data together
    const tagsWithDetails = templateTags.map(tt => {
      const tagDefinition = tagDefinitionMap.get(tt.ttd_id);
      return {
        tt_id: tt.tt_id,
        template_id: tt.template_id,
        ttd_id: tt.ttd_id,
        tag_name: tagDefinition ? tagDefinition.tag_name : null,
        tag_code: tagDefinition ? tagDefinition.tag_code : null,
        tag_description: tagDefinition ? tagDefinition.tag_description : null,
        created_at: tt.created_at,
        updated_at: tt.updated_at
      };
    });

    return tagsWithDetails;
  } catch (error) {
    logger.error('Error getting template tags with details', {
      error: error.message,
      templateId
    });
    return [];
  }
}


/**
 * @api {get} /templates List templates
 * @apiVersion 1.0.0
 * @apiName ListTemplates
 * @apiGroup Templates
 * @apiPermission JWT
 *
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.listTemplates = async function (req, res) {
  try {
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const templates = await TemplateModel.listTemplates(paginationParams);

    // Generate presigned URLs if templates exist
    if (templates.length) {
      const storage = StorageFactory.getProvider();

      // Get all template IDs for batch database calls
      const templateIds = templates.map(template => template.template_id);

      // Batch fetch all clips for all templates
      const allClips = await TemplateModel.getTemplateAiClipsForMultipleTemplates(templateIds);
      const clipsMap = new Map();
      allClips.forEach(clip => {
        if (!clipsMap.has(clip.template_id)) {
          clipsMap.set(clip.template_id, []);
        }
        clipsMap.get(clip.template_id).push(clip);
      });

      // Batch fetch all template tags for all templates
      const allTemplateTags = await TemplateModel.getTemplateTagsForMultipleTemplates(templateIds);
      const templateTagsMap = new Map();
      allTemplateTags.forEach(tag => {
        if (!templateTagsMap.has(tag.template_id)) {
          templateTagsMap.set(tag.template_id, []);
        }
        templateTagsMap.get(tag.template_id).push(tag);
      });

      // Get all unique ttd_ids for batch tag definition lookup
      const allTtdIds = [...new Set(allTemplateTags.map(tag => tag.ttd_id))];
      const tagDefinitions = allTtdIds.length > 0 ?
        await TemplateTagDefinitionModel.getTemplateTagDefinitionsByIds(allTtdIds) : [];
      const tagDefinitionMap = new Map();
      tagDefinitions.forEach(tagDef => {
        tagDefinitionMap.set(tagDef.ttd_id, tagDef);
      });

      // Get all unique facet_ids for batch facet lookup
      const allFacetIds = [...new Set(tagDefinitions.map(tagDef => tagDef.facet_id))];
      const facets = allFacetIds.length > 0 ?
        await TemplateTagFacetModel.getTemplateTagFacetsByIds(allFacetIds) : [];
      const facetMap = new Map();
      facets.forEach(facet => {
        facetMap.set(facet.facet_id, facet);
      });

      await Promise.all(templates.map(async (template) => {
        // Generate R2 URL for template thumbnail
        if (template.cf_r2_key) {
          template.r2_url = `${config.os2.r2.public.bucketUrl}/${template.cf_r2_key}`;
        } else {
          template.r2_url = template.cf_r2_url;
        }

        // Load AI clips for all templates (from pre-fetched data)
        template.clips = clipsMap.get(template.template_id) || [];

        // Generate R2 URLs for AI clip assets
        if (template.clips && template.clips.length > 0) {
          template.clips = template.clips.map(clip => {
            // Generate R2 URL for template image asset
            if (clip.template_image_asset_key && clip.template_image_asset_bucket) {
              clip.template_image_asset_r2_url = `${config.os2.r2.public.bucketUrl}/${clip.template_image_asset_key}`;
            }

            // Generate R2 URL for video file asset
            if (clip.video_file_asset_key && clip.video_file_asset_bucket) {
              clip.video_file_asset_r2_url = `${config.os2.r2.public.bucketUrl}/${clip.video_file_asset_key}`;
            }

            // Enrich workflow steps: add URL for uploaded assets/images inside file_upload steps
            if (Array.isArray(clip.workflow)) {
              clip.workflow = clip.workflow.map(step => {
                if (!step || !Array.isArray(step.data)) return step;
                step.data = step.data.map(item => {
                  const itemType = String(item?.type || '').toLowerCase();
                  if (itemType === 'file_upload' && item && item.value && item.value.asset_key) {
                    item.value.asset_r2_url = `${config.os2.r2.public.bucketUrl}/${item.value.asset_key}`;
                  }
                  return item;
                });
                return step;
              });
            }

            return clip;
          });
        }

        // Fallback compute of image uploads required if not present or invalid
        if (
          template.image_uploads_required === undefined ||
          template.image_uploads_required === null ||
          Number.isNaN(Number(template.image_uploads_required))
        ) {
          template.image_uploads_required = calculateImageUploadsRequiredFromClips(template.clips || []);
        }

        // Generate R2 URLs for template assets
        if (template.color_video_key && template.color_video_bucket) {
          template.color_video_r2_url = `${config.os2.r2.public.bucketUrl}/${template.color_video_key}`;
        }
        if (template.mask_video_key && template.mask_video_bucket) {
          template.mask_video_r2_url = `${config.os2.r2.public.bucketUrl}/${template.mask_video_key}`;
        }
        if (template.bodymovin_json_key && template.bodymovin_json_bucket) {
          template.bodymovin_json_r2_url = `${config.os2.r2.public.bucketUrl}/${template.bodymovin_json_key}`;
        }

        // Generate presigned download URL for thumb_frame if available
        if (template.thumb_frame_asset_key && template.thumb_frame_bucket) {
          try {
            const isPublic = template.thumb_frame_bucket === 'public' ||
              template.thumb_frame_bucket === storage.publicBucket ||
              template.thumb_frame_bucket === (config.os2?.r2?.public?.bucket);

            if (isPublic) {
              template.thumb_frame_url = `${config.os2.r2.public.bucketUrl}/${template.thumb_frame_asset_key}`;
            } else {
              template.thumb_frame_url = await storage.generatePresignedDownloadUrl(template.thumb_frame_asset_key, { expiresIn: 3600 });
            }
          } catch (error) {
            logger.error('Error generating thumb_frame presigned URL:', {
              error: error.message,
              template_id: template.template_id,
              thumb_frame_asset_key: template.thumb_frame_asset_key,
              thumb_frame_bucket: template.thumb_frame_bucket
            });
            template.thumb_frame_url = null;
          }
        }

        // Parse JSON fields if they are strings
        if (template.faces_needed && typeof template.faces_needed === 'string') {
          try {
            template.faces_needed = JSON.parse(template.faces_needed);

            // Generate R2 URLs for character faces if they exist
            if (template.faces_needed) {
              template.faces_needed = template.faces_needed.map(face => {
                if (face.character_face_r2_key) {
                  face.r2_url = `${config.os2.r2.public.bucketUrl}/${face.character_face_r2_key}`;
                }
                return face;
              });
            }
          } catch (err) {
            logger.error('Error parsing faces_needed:', {
              error: err.message,
              value: template.faces_needed
            });
          }
        } else if (template.faces_needed && Array.isArray(template.faces_needed)) {
          template.faces_needed = template.faces_needed.map(face => {
            if (face.character_face_r2_key) {
              face.r2_url = `${config.os2.r2.public.bucketUrl}/${face.character_face_r2_key}`;
            }
            return face;
          });
        }

        if (template.additional_data && typeof template.additional_data === 'string') {
          try {
            template.additional_data = JSON.parse(template.additional_data);
          } catch (err) {
            logger.error('Error parsing additional_data:', {
              error: err.message,
              value: template.additional_data
            });
          }
        }

        if (template.custom_text_input_fields && typeof template.custom_text_input_fields === 'string') {
          try {
            template.custom_text_input_fields = JSON.parse(template.custom_text_input_fields);
          } catch (err) {
            logger.error('Error parsing custom_text_input_fields:', {
              error: err.message,
              value: template.custom_text_input_fields
            });
          }
        }

        if (template.image_input_fields_json && typeof template.image_input_fields_json === 'string') {
          try {
            template.image_input_fields_json = JSON.parse(template.image_input_fields_json);
          } catch (err) {
            logger.error('Error parsing image_input_fields_json:', {
              error: err.message,
              value: template.image_input_fields_json
            });
          }
        }

        if (Array.isArray(template.image_input_fields_json)) {
          template.image_input_fields_json.forEach(field => {
            if (field.reference_image && field.reference_image.asset_key) {
              field.reference_image.url = `${config.os2.r2.public.bucketUrl}/${field.reference_image.asset_key}`;
            }
          });
        }

        // Load template tags (both auto-generated and manually assigned) - from pre-fetched data
        template.tags = getTemplateTagsWithDetailsFromPrefetched(template.template_id, templateTagsMap, tagDefinitionMap);

        // Load manually assigned template tags (from pre-fetched data)
        template.template_tags = templateTagsMap.get(template.template_id) || [];

        // Stitch facet information for template tags (using pre-fetched data)
        if (template.template_tags && template.template_tags.length > 0) {
          // Use pre-fetched tag definitions and facets

          // Stitch the data together
          template.template_tags.forEach(tag => {
            const tagDefinition = tagDefinitionMap.get(tag.ttd_id);

            if (tagDefinition) {
              // Add tag definition data
              tag.tag_name = tagDefinition.tag_name;
              tag.tag_code = tagDefinition.tag_code;
              tag.tag_description = tagDefinition.tag_description;
              tag.is_active = tagDefinition.is_active;

              // Use facet_id from tag definition (primary source)
              const facetId = tagDefinition.facet_id;
              if (facetId) {
                tag.facet_id = facetId; // Ensure facet_id is present

                const facet = facetMap.get(facetId);
                if (facet) {
                  tag.facet_key = facet.facet_key;
                  tag.facet_display_name = facet.display_name;
                  tag.facet_cardinality = facet.cardinality;
                  tag.facet_strict = facet.strict;
                  tag.facet_required_for_publish = facet.required_for_publish;
                  tag.facet_visible = facet.visible;
                  tag.facet_allow_suggestions = facet.allow_suggestions;
                }
              }
            }
          });
        }
      }));
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: templates
    });

  } catch (error) {
    logger.error('Error listing templates:', { error: error.message, stack: error.stack });
    TemplateErrorHandler.handleTemplateErrors(error, res);
  }
};

/**
 * @api {get} /templates/:templateId Get single template
 * @apiVersion 1.0.0
 * @apiName GetTemplate
 * @apiGroup Templates
 * @apiPermission JWT
 *
 * @apiParam {String} templateId Template ID
 */
exports.getTemplate = async function (req, res) {
  try {
    const { templateId } = req.params;

    if (!templateId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        error: 'Template ID is required'
      });
    }

    // Get template by ID
    const template = await TemplateModel.getTemplateById(templateId);

    if (!template) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        error: 'Template not found'
      });
    }

    const storage = StorageFactory.getProvider();

    // Generate R2 URL for template thumbnail
    if (template.cf_r2_key) {
      template.r2_url = `${config.os2.r2.public.bucketUrl}/${template.cf_r2_key}`;
    } else {
      template.r2_url = template.cf_r2_url;
    }

    // Load AI clips for template
    template.clips = await TemplateModel.getTemplateAiClips(template.template_id);

    // Generate R2 URLs for AI clip assets
    if (template.clips && template.clips.length > 0) {
      template.clips = template.clips.map(clip => {
        // Generate R2 URL for template image asset
        if (clip.template_image_asset_key && clip.template_image_asset_bucket) {
          clip.template_image_asset_r2_url = `${config.os2.r2.public.bucketUrl}/${clip.template_image_asset_key}`;
        }

        // Generate R2 URL for video file asset
        if (clip.video_file_asset_key && clip.video_file_asset_bucket) {
          clip.video_file_asset_r2_url = `${config.os2.r2.public.bucketUrl}/${clip.video_file_asset_key}`;
        }

        // Enrich workflow steps: add URL for uploaded assets/images inside file_upload steps
        if (Array.isArray(clip.workflow)) {
          clip.workflow = clip.workflow.map(step => {
            if (!step || !Array.isArray(step.data)) return step;
            step.data = step.data.map(item => {
              const itemType = String(item?.type || '').toLowerCase();
              if (itemType === 'file_upload' && item && item.value && item.value.asset_key) {
                item.value.asset_r2_url = `${config.os2.r2.public.bucketUrl}/${item.value.asset_key}`;
              }
              return item;
            });
            return step;
          });
        }

        return clip;
      });
    }

    // Fallback compute of image uploads required if not present or invalid
    if (
      template.image_uploads_required === undefined ||
      template.image_uploads_required === null ||
      Number.isNaN(Number(template.image_uploads_required))
    ) {
      template.image_uploads_required = calculateImageUploadsRequiredFromClips(template.clips || []);
    }

    // Generate R2 URLs for template assets
    if (template.color_video_key && template.color_video_bucket) {
      template.color_video_r2_url = `${config.os2.r2.public.bucketUrl}/${template.color_video_key}`;
    }
    if (template.mask_video_key && template.mask_video_bucket) {
      template.mask_video_r2_url = `${config.os2.r2.public.bucketUrl}/${template.mask_video_key}`;
    }
    if (template.bodymovin_json_key && template.bodymovin_json_bucket) {
      template.bodymovin_json_r2_url = `${config.os2.r2.public.bucketUrl}/${template.bodymovin_json_key}`;
    }

    // Generate presigned download URL for thumb_frame if available
    if (template.thumb_frame_asset_key && template.thumb_frame_bucket) {
      try {
        const isPublic = template.thumb_frame_bucket === 'public' ||
          template.thumb_frame_bucket === storage.publicBucket ||
          template.thumb_frame_bucket === (config.os2?.r2?.public?.bucket);

        if (isPublic) {
          template.thumb_frame_url = `${config.os2.r2.public.bucketUrl}/${template.thumb_frame_asset_key}`;
        } else {
          template.thumb_frame_url = await storage.generatePresignedDownloadUrl(template.thumb_frame_asset_key, { expiresIn: 3600 });
        }
      } catch (error) {
        logger.error('Error generating thumb_frame presigned URL:', {
          error: error.message,
          template_id: template.template_id,
          thumb_frame_asset_key: template.thumb_frame_asset_key,
          thumb_frame_bucket: template.thumb_frame_bucket
        });
        template.thumb_frame_url = null;
      }
    }

    // Parse JSON fields if they are strings
    if (template.faces_needed && typeof template.faces_needed === 'string') {
      try {
        template.faces_needed = JSON.parse(template.faces_needed);

        // Generate R2 URLs for character faces if they exist
        if (template.faces_needed) {
          template.faces_needed = template.faces_needed.map(face => {
            if (face.character_face_r2_key) {
              face.r2_url = `${config.os2.r2.public.bucketUrl}/${face.character_face_r2_key}`;
            }
            return face;
          });
        }
      } catch (err) {
        logger.error('Error parsing faces_needed:', {
          error: err.message,
          value: template.faces_needed
        });
      }
    } else if (template.faces_needed && Array.isArray(template.faces_needed)) {
      template.faces_needed = template.faces_needed.map(face => {
        if (face.character_face_r2_key) {
          face.r2_url = `${config.os2.r2.public.bucketUrl}/${face.character_face_r2_key}`;
        }
        return face;
      });
    }

    if (template.additional_data && typeof template.additional_data === 'string') {
      try {
        template.additional_data = JSON.parse(template.additional_data);
      } catch (err) {
        logger.error('Error parsing additional_data:', {
          error: err.message,
          value: template.additional_data
        });
      }
    }

    if (template.custom_text_input_fields && typeof template.custom_text_input_fields === 'string') {
      try {
        template.custom_text_input_fields = JSON.parse(template.custom_text_input_fields);
      } catch (err) {
        logger.error('Error parsing custom_text_input_fields:', {
          error: err.message,
          value: template.custom_text_input_fields
        });
      }
    }

    if (template.image_input_fields_json && typeof template.image_input_fields_json === 'string') {
      try {
        template.image_input_fields_json = JSON.parse(template.image_input_fields_json);
      } catch (err) {
        logger.error('Error parsing image_input_fields_json:', {
          error: err.message,
          value: template.image_input_fields_json
        });
      }
    }

    if (Array.isArray(template.image_input_fields_json)) {
      template.image_input_fields_json.forEach(field => {
        if (field.reference_image && field.reference_image.asset_key) {
          field.reference_image.url = `${config.os2.r2.public.bucketUrl}/${field.reference_image.asset_key}`;
        }
      });
    }

    // Load template tags with full details
    template.tags = await getTemplateTagsWithDetails(template.template_id);
    template.template_tags = await TemplateModel.getTemplateTags(template.template_id);

    // Stitch facet information for template tags
    if (template.template_tags && template.template_tags.length > 0) {
      // Get all unique ttd_ids
      const ttdIds = [...new Set(template.template_tags.map(tag => tag.ttd_id))];

      // Get tag definitions
      const tagDefinitions = ttdIds.length > 0 ?
        await TemplateTagDefinitionModel.getTemplateTagDefinitionsByIds(ttdIds) : [];
      const tagDefinitionMap = new Map();
      tagDefinitions.forEach(tagDef => {
        tagDefinitionMap.set(tagDef.ttd_id, tagDef);
      });

      // Get all unique facet_ids
      const facetIds = [...new Set(tagDefinitions.map(tagDef => tagDef.facet_id))];
      const facets = facetIds.length > 0 ?
        await TemplateTagFacetModel.getTemplateTagFacetsByIds(facetIds) : [];
      const facetMap = new Map();
      facets.forEach(facet => {
        facetMap.set(facet.facet_id, facet);
      });

      // Stitch the data together
      template.template_tags.forEach(tag => {
        const tagDefinition = tagDefinitionMap.get(tag.ttd_id);

        if (tagDefinition) {
          // Add tag definition data
          tag.tag_name = tagDefinition.tag_name;
          tag.tag_code = tagDefinition.tag_code;
          tag.tag_description = tagDefinition.tag_description;
          tag.is_active = tagDefinition.is_active;

          // Use facet_id from tag definition (primary source)
          const facetId = tagDefinition.facet_id;
          if (facetId) {
            tag.facet_id = facetId; // Ensure facet_id is present

            const facet = facetMap.get(facetId);
            if (facet) {
              tag.facet_key = facet.facet_key;
              tag.facet_display_name = facet.display_name;
              tag.facet_cardinality = facet.cardinality;
              tag.facet_strict = facet.strict;
              tag.facet_required_for_publish = facet.required_for_publish;
              tag.facet_visible = facet.visible;
              tag.facet_allow_suggestions = facet.allow_suggestions;
            }
          }
        }
      });
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: template
    });

  } catch (error) {
    logger.error('Error getting template:', { error: error.message, stack: error.stack, templateId: req.params.templateId });
    TemplateErrorHandler.handleTemplateErrors(error, res);
  }
};

/**
 * Ensure template_ai_clips rows exist for the given clip definitions; create a workflow per clip
 * and attach wf_id in template_ai_clips. Use when get template returns empty clips (e.g. new/legacy template).
 * Body: { clips: [ { clip_index: number, asset_type: 'image'|'video' }, ... ] }
 */
exports.ensureTemplateAiClips = async function (req, res) {
  try {
    const { templateId } = req.params;
    const { clips } = req.validatedBody;
    const userId = req.user.userId;

    const template = await TemplateModel.getTemplateById(templateId);
    if (!template) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        error: 'Template not found'
      });
    }

    const resultClips = await TemplateModel.ensureTemplateAiClipsWithWorkflows(templateId, clips, userId);

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: { clips: resultClips }
    });
  } catch (error) {
    logger.error('Error ensuring template AI clips:', { error: error.message, templateId: req.params.templateId });
    TemplateErrorHandler.handleTemplateErrors(error, res);
  }
};

/**
 * @api {get} /templates/archived List archived templates
 * @apiVersion 1.0.0
 * @apiName ListArchivedTemplates
 * @apiGroup Templates
 * @apiPermission JWT
 *
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.listArchivedTemplates = async function (req, res) {
  try {
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const templates = await TemplateModel.listArchivedTemplates(paginationParams);

    // Generate presigned URLs if templates exist
    if (templates.length) {
      const storage = StorageFactory.getProvider();

      await Promise.all(templates.map(async (template) => {
        // Generate R2 URL for template thumbnail
        if (template.cf_r2_key) {
          template.r2_url = `${config.os2.r2.public.bucketUrl}/${template.cf_r2_key}`;
        } else {
          template.r2_url = template.cf_r2_url;
        }

        // Load AI clips for all templates
        template.clips = await TemplateModel.getTemplateAiClips(template.template_id);

        // Generate R2 URLs for AI clip assets
        if (template.clips && template.clips.length > 0) {
          template.clips = template.clips.map(clip => {
            // Generate R2 URL for template image asset
            if (clip.template_image_asset_key && clip.template_image_asset_bucket) {
              clip.template_image_asset_r2_url = `${config.os2.r2.public.bucketUrl}/${clip.template_image_asset_key}`;
            }

            // Generate R2 URL for video file asset
            if (clip.video_file_asset_key && clip.video_file_asset_bucket) {
              clip.video_file_asset_r2_url = `${config.os2.r2.public.bucketUrl}/${clip.video_file_asset_key}`;
            }

            // Enrich workflow steps: add URL for uploaded assets/images inside file_upload steps
            if (Array.isArray(clip.workflow)) {
              clip.workflow = clip.workflow.map(step => {
                if (!step || !Array.isArray(step.data)) return step;
                step.data = step.data.map(item => {
                  const itemType = String(item?.type || '').toLowerCase();
                  if (itemType === 'file_upload' && item && item.value && item.value.asset_key) {
                    item.value.asset_r2_url = `${config.os2.r2.public.bucketUrl}/${item.value.asset_key}`;
                  }
                  return item;
                });
                return step;
              });
            }

            return clip;
          });
        }

        // Fallback compute of image uploads required if not present or invalid
        if (
          template.image_uploads_required === undefined ||
          template.image_uploads_required === null ||
          Number.isNaN(Number(template.image_uploads_required))
        ) {
          template.image_uploads_required = calculateImageUploadsRequiredFromClips(template.clips || []);
        }

        // Generate R2 URLs for template assets
        if (template.color_video_key && template.color_video_bucket) {
          template.color_video_r2_url = `${config.os2.r2.public.bucketUrl}/${template.color_video_key}`;
        }
        if (template.mask_video_key && template.mask_video_bucket) {
          template.mask_video_r2_url = `${config.os2.r2.public.bucketUrl}/${template.mask_video_key}`;
        }
        if (template.bodymovin_json_key && template.bodymovin_json_bucket) {
          template.bodymovin_json_r2_url = `${config.os2.r2.public.bucketUrl}/${template.bodymovin_json_key}`;
        }

        // Generate presigned download URL for thumb_frame if available
        if (template.thumb_frame_asset_key && template.thumb_frame_bucket) {
          try {
            const isPublic = template.thumb_frame_bucket === 'public' ||
              template.thumb_frame_bucket === storage.publicBucket ||
              template.thumb_frame_bucket === (config.os2?.r2?.public?.bucket);

            if (isPublic) {
              template.thumb_frame_url = `${config.os2.r2.public.bucketUrl}/${template.thumb_frame_asset_key}`;
            } else {
              template.thumb_frame_url = await storage.generatePresignedDownloadUrl(template.thumb_frame_asset_key, { expiresIn: 3600 });
            }
          } catch (error) {
            logger.error('Error generating thumb_frame presigned URL:', {
              error: error.message,
              template_id: template.template_id,
              thumb_frame_asset_key: template.thumb_frame_asset_key,
              thumb_frame_bucket: template.thumb_frame_bucket
            });
            template.thumb_frame_url = null;
          }
        }

        if (template.image_input_fields_json && typeof template.image_input_fields_json === 'string') {
          try {
            template.image_input_fields_json = JSON.parse(template.image_input_fields_json);
          } catch (err) {
            logger.error('Error parsing image_input_fields_json:', {
              error: err.message,
              value: template.image_input_fields_json
            });
          }
        }

        if (Array.isArray(template.image_input_fields_json)) {
          template.image_input_fields_json.forEach(field => {
            if (field.reference_image && field.reference_image.asset_key) {
              field.reference_image.url = `${config.os2.r2.public.bucketUrl}/${field.reference_image.asset_key}`;
            }
          });
        }

        // Parse JSON fields if they are strings
        if (template.faces_needed && typeof template.faces_needed === 'string') {
          try {
            template.faces_needed = JSON.parse(template.faces_needed);

            // Generate R2 URLs for character faces if they exist
            if (template.faces_needed) {
              template.faces_needed = template.faces_needed.map(face => {
                if (face.character_face_r2_key) {
                  face.r2_url = `${config.os2.r2.public.bucketUrl}/${face.character_face_r2_key}`;
                }
                return face;
              });
            }
          } catch (err) {
            logger.error('Error parsing faces_needed:', {
              error: err.message,
              value: template.faces_needed
            });
          }
        } else if (template.faces_needed && Array.isArray(template.faces_needed)) {
          template.faces_needed = template.faces_needed.map(face => {
            if (face.character_face_r2_key) {
              face.r2_url = `${config.os2.r2.public.bucketUrl}/${face.character_face_r2_key}`;
            }
            return face;
          });
        }

        if (template.additional_data && typeof template.additional_data === 'string') {
          try {
            template.additional_data = JSON.parse(template.additional_data);
          } catch (err) {
            logger.error('Error parsing additional_data:', {
              error: err.message,
              value: template.additional_data
            });
          }
        }

        if (template.custom_text_input_fields && typeof template.custom_text_input_fields === 'string') {
          try {
            template.custom_text_input_fields = JSON.parse(template.custom_text_input_fields);
          } catch (err) {
            logger.error('Error parsing custom_text_input_fields:', {
              error: err.message,
              value: template.custom_text_input_fields
            });
          }
        }

        // Load template tags (both auto-generated and manually assigned)
        template.tags = await getTemplateTagsWithDetails(template.template_id);

        // Load manually assigned template tags
        template.template_tags = await TemplateModel.getTemplateTags(template.template_id);

        // Stitch facet information for template tags
        if (template.template_tags && template.template_tags.length > 0) {
          const ttdIds = [...new Set(template.template_tags.map(tag => tag.ttd_id))];

          // Get tag definitions first to get facet_id information
          const tagDefinitions = await TemplateTagDefinitionModel.getTemplateTagDefinitionsByIds(ttdIds);

          // Create lookup map for tag definitions
          const tagDefinitionMap = new Map();
          tagDefinitions.forEach(tagDef => {
            tagDefinitionMap.set(tagDef.ttd_id, tagDef);
          });

          // Get facet_ids from tag definitions and create facet lookup
          const facetIds = [...new Set(tagDefinitions.map(tagDef => tagDef.facet_id))];
          const facets = await TemplateTagFacetModel.getTemplateTagFacetsByIds(facetIds);

          // Create lookup map for facets
          const facetMap = new Map();
          facets.forEach(facet => {
            facetMap.set(facet.facet_id, facet);
          });

          // Stitch the data together
          template.template_tags.forEach(tag => {
            const tagDefinition = tagDefinitionMap.get(tag.ttd_id);

            if (tagDefinition) {
              // Add tag definition data
              tag.tag_name = tagDefinition.tag_name;
              tag.tag_code = tagDefinition.tag_code;
              tag.tag_description = tagDefinition.tag_description;
              tag.is_active = tagDefinition.is_active;

              // Get facet_id from tag definition (template_tags table doesn't store facet_id)
              const facetId = tagDefinition.facet_id;
              if (facetId) {
                tag.facet_id = facetId; // Ensure facet_id is present

                const facet = facetMap.get(facetId);
                if (facet) {
                  tag.facet_key = facet.facet_key;
                  tag.facet_display_name = facet.display_name;
                  tag.facet_cardinality = facet.cardinality;
                  tag.facet_strict = facet.strict;
                  tag.facet_required_for_publish = facet.required_for_publish;
                  tag.facet_visible = facet.visible;
                  tag.facet_allow_suggestions = facet.allow_suggestions;
                }
              }
            }
          });
        }
      }));
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: templates
    });

  } catch (error) {
    logger.error('Error listing archived templates:', { error: error.message, stack: error.stack });
    TemplateErrorHandler.handleTemplateErrors(error, res);
  }
};

/**
 * @api {get} /templates/search Search templates
 * @apiVersion 1.0.0
 * @apiName SearchTemplates
 * @apiGroup Templates
 * @apiPermission JWT
 *
 * @apiQuery {String} q Search query
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.searchTemplates = async function (req, res) {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: req.t('template:SEARCH_QUERY_REQUIRED')
      });
    }

    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const templates = await TemplateModel.searchTemplates(q, paginationParams.page, paginationParams.limit);

    // Generate presigned URLs if templates exist
    if (templates.length) {
      const storage = StorageFactory.getProvider();

      await Promise.all(templates.map(async (template) => {
        // Generate R2 URL for template thumbnail
        if (template.cf_r2_key) {
          template.r2_url = `${config.os2.r2.public.bucketUrl}/${template.cf_r2_key}`;
        } else {
          template.r2_url = template.cf_r2_url;
        }

        // Load AI clips for all templates
        template.clips = await TemplateModel.getTemplateAiClips(template.template_id);

        // Generate R2 URLs for AI clip assets
        if (template.clips && template.clips.length > 0) {
          template.clips = template.clips.map(clip => {
            // Generate R2 URL for template image asset
            if (clip.template_image_asset_key && clip.template_image_asset_bucket) {
              clip.template_image_asset_r2_url = `${config.os2.r2.public.bucketUrl}/${clip.template_image_asset_key}`;
            }

            // Generate R2 URL for video file asset
            if (clip.video_file_asset_key && clip.video_file_asset_bucket) {
              clip.video_file_asset_r2_url = `${config.os2.r2.public.bucketUrl}/${clip.video_file_asset_key}`;
            }

            // Enrich workflow steps: add URL for uploaded assets/images inside file_upload steps
            if (Array.isArray(clip.workflow)) {
              clip.workflow = clip.workflow.map(step => {
                if (!step || !Array.isArray(step.data)) return step;
                step.data = step.data.map(item => {
                  const itemType = String(item?.type || '').toLowerCase();
                  if (itemType === 'file_upload' && item && item.value && item.value.asset_key) {
                    item.value.asset_r2_url = `${config.os2.r2.public.bucketUrl}/${item.value.asset_key}`;
                  }
                  return item;
                });
                return step;
              });
            }

            return clip;
          });
        }

        // Fallback compute of image uploads required if not present or invalid
        if (
          template.image_uploads_required === undefined ||
          template.image_uploads_required === null ||
          Number.isNaN(Number(template.image_uploads_required))
        ) {
          template.image_uploads_required = calculateImageUploadsRequiredFromClips(template.clips || []);
        }

        // Generate R2 URLs for template assets
        if (template.color_video_key && template.color_video_bucket) {
          template.color_video_r2_url = `${config.os2.r2.public.bucketUrl}/${template.color_video_key}`;
        }
        if (template.mask_video_key && template.mask_video_bucket) {
          template.mask_video_r2_url = `${config.os2.r2.public.bucketUrl}/${template.mask_video_key}`;
        }
        if (template.bodymovin_json_key && template.bodymovin_json_bucket) {
          template.bodymovin_json_r2_url = `${config.os2.r2.public.bucketUrl}/${template.bodymovin_json_key}`;
        }

        // Generate presigned download URL for thumb_frame if available
        if (template.thumb_frame_asset_key && template.thumb_frame_bucket) {
          try {
            const isPublic = template.thumb_frame_bucket === 'public' ||
              template.thumb_frame_bucket === storage.publicBucket ||
              template.thumb_frame_bucket === (config.os2?.r2?.public?.bucket);

            if (isPublic) {
              template.thumb_frame_url = `${config.os2.r2.public.bucketUrl}/${template.thumb_frame_asset_key}`;
            } else {
              template.thumb_frame_url = await storage.generatePresignedDownloadUrl(template.thumb_frame_asset_key, { expiresIn: 3600 });
            }
          } catch (error) {
            logger.error('Error generating thumb_frame presigned URL:', {
              error: error.message,
              template_id: template.template_id,
              thumb_frame_asset_key: template.thumb_frame_asset_key,
              thumb_frame_bucket: template.thumb_frame_bucket
            });
            template.thumb_frame_url = null;
          }
        }

        // Parse JSON fields if they are strings
        if (template.faces_needed && typeof template.faces_needed === 'string') {
          try {
            template.faces_needed = JSON.parse(template.faces_needed);
          } catch (err) {
            logger.error('Error parsing faces_needed:', {
              error: err.message,
              value: template.faces_needed
            });
          }
        }

        if (template.additional_data && typeof template.additional_data === 'string') {
          try {
            template.additional_data = JSON.parse(template.additional_data);
          } catch (err) {
            logger.error('Error parsing additional_data:', {
              error: err.message,
              value: template.additional_data
            });
          }
        }

        if (template.custom_text_input_fields && typeof template.custom_text_input_fields === 'string') {
          try {
            template.custom_text_input_fields = JSON.parse(template.custom_text_input_fields);
          } catch (err) {
            logger.error('Error parsing custom_text_input_fields:', {
              error: err.message,
              value: template.custom_text_input_fields
            });
          }
        }

        // Load template tags (both auto-generated and manually assigned)
        template.tags = await getTemplateTagsWithDetails(template.template_id);

        // Load manually assigned template tags
        template.template_tags = await TemplateModel.getTemplateTags(template.template_id);

        // Stitch facet information for template tags
        if (template.template_tags && template.template_tags.length > 0) {
          const ttdIds = [...new Set(template.template_tags.map(tag => tag.ttd_id))];

          // Get tag definitions first to get facet_id information
          const tagDefinitions = await TemplateTagDefinitionModel.getTemplateTagDefinitionsByIds(ttdIds);

          // Create lookup map for tag definitions
          const tagDefinitionMap = new Map();
          tagDefinitions.forEach(tagDef => {
            tagDefinitionMap.set(tagDef.ttd_id, tagDef);
          });

          // Get facet_ids from tag definitions and create facet lookup
          const facetIds = [...new Set(tagDefinitions.map(tagDef => tagDef.facet_id))];
          const facets = await TemplateTagFacetModel.getTemplateTagFacetsByIds(facetIds);

          // Create lookup map for facets
          const facetMap = new Map();
          facets.forEach(facet => {
            facetMap.set(facet.facet_id, facet);
          });

          // Stitch the data together
          template.template_tags.forEach(tag => {
            const tagDefinition = tagDefinitionMap.get(tag.ttd_id);

            if (tagDefinition) {
              // Add tag definition data
              tag.tag_name = tagDefinition.tag_name;
              tag.tag_code = tagDefinition.tag_code;
              tag.tag_description = tagDefinition.tag_description;
              tag.is_active = tagDefinition.is_active;

              // Get facet_id from tag definition (template_tags table doesn't store facet_id)
              const facetId = tagDefinition.facet_id;
              if (facetId) {
                tag.facet_id = facetId; // Ensure facet_id is present

                const facet = facetMap.get(facetId);
                if (facet) {
                  tag.facet_key = facet.facet_key;
                  tag.facet_display_name = facet.display_name;
                  tag.facet_cardinality = facet.cardinality;
                  tag.facet_strict = facet.strict;
                  tag.facet_required_for_publish = facet.required_for_publish;
                  tag.facet_visible = facet.visible;
                  tag.facet_allow_suggestions = facet.allow_suggestions;
                }
              }
            }
          });
        }
      }));
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: templates
    });

  } catch (error) {
    logger.error('Error searching templates:', { error: error.message, stack: error.stack });
    TemplateErrorHandler.handleTemplateErrors(error, res);
  }
};

/**
 * Process custom_text_input_fields to create new niche data field definitions
 * and remove new_field from the data before storing
 * @param {Array} customTextInputFields - Array of custom text input field objects
 */
async function processNewFieldsInCustomTextInputFields(customTextInputFields) {
  if (!Array.isArray(customTextInputFields)) {
    return;
  }

  // Group fields by niche_slug (we'll need to get niche_id from slug)
  const fieldsByNiche = {};

  for (const field of customTextInputFields) {
    if (field.new_field) {
      // Extract niche_slug from the field or use a default
      // Note: In the current implementation, niche_slug is not in the field object
      // We'll need to get it from the template or pass it separately
      // For now, we'll skip this and handle it differently
      // This function will be called with niche_slug context
    }
  }

  // Process each field with new_field
  for (let i = 0; i < customTextInputFields.length; i++) {
    const field = customTextInputFields[i];
    if (field.new_field) {
      try {
        // Get niche_id from niche_slug (we need to pass niche_slug to this function)
        // For now, we'll need to modify the function signature
        // This is a placeholder - we'll need to get niche_slug from the template data
        logger.warn('processNewFieldsInCustomTextInputFields: new_field found but niche_slug not available in field object', {
          fieldIndex: i,
          newField: field.new_field
        });

        // Remove new_field from the field object before storing
        delete field.new_field;
      } catch (error) {
        logger.error('Error processing new field:', {
          error: error.message,
          fieldIndex: i,
          newField: field.new_field
        });
        // Remove new_field even on error to prevent storing it
        delete field.new_field;
      }
    }
  }
}

/**
 * Process new fields in custom_text_input_fields with niche_slug context
 * @param {Array} customTextInputFields - Array of custom text input field objects
 * @param {String} nicheSlug - Niche slug to create fields for
 */
async function processNewFieldsWithNicheSlug(customTextInputFields, nicheSlug) {
  if (!Array.isArray(customTextInputFields) || !nicheSlug) {
    return;
  }

  try {
    // Get niche by slug
    const niche = await NicheModel.getNicheBySlug(nicheSlug);
    if (!niche) {
      logger.warn('Niche not found for slug:', { nicheSlug });
      // Remove new_field from all fields
      customTextInputFields.forEach(field => {
        if (field.new_field) {
          delete field.new_field;
        }
      });
      return;
    }

    const nicheId = niche.niche_id;
    const newFieldsToCreate = [];

    // Collect all new fields
    for (let i = 0; i < customTextInputFields.length; i++) {
      const field = customTextInputFields[i];
      if (field.new_field) {
        newFieldsToCreate.push({
          niche_id: nicheId,
          field_code: field.new_field.field_code,
          field_label: field.new_field.field_label,
          field_data_type: field.new_field.field_data_type,
          is_visible_in_first_time_flow: 0,
          display_order: i + 1
        });

        // Replace new_field with nfd_field_code after creation
        // We'll update this after bulk create
      }
    }

    // Bulk create new field definitions
    if (newFieldsToCreate.length > 0) {
      const createResult = await NicheDataFieldDefinitionModel.bulkCreateNicheDataFieldDefinitions(newFieldsToCreate);

      // Fetch created fields by their IDs to get field_codes
      const createdFieldIds = createResult.insertIds || [];
      const createdFields = [];
      for (const fieldId of createdFieldIds) {
        const createdField = await NicheDataFieldDefinitionModel.getNicheDataFieldDefinitionById(fieldId);
        if (createdField) {
          createdFields.push(createdField);
        }
      }

      // Update custom_text_input_fields to use nfd_field_code instead of new_field
      let createdIndex = 0;
      for (let i = 0; i < customTextInputFields.length; i++) {
        const field = customTextInputFields[i];
        if (field.new_field) {
          // Get the created field's field_code
          const createdField = createdFields[createdIndex];
          if (createdField) {
            field.nfd_field_code = createdField.field_code;
          }
          // Remove new_field
          delete field.new_field;
          createdIndex++;
        }
      }

      logger.info('Created new niche data field definitions', {
        nicheSlug,
        nicheId,
        count: createdFields.length
      });
    }
  } catch (error) {
    logger.error('Error processing new fields with niche slug:', {
      error: error.message,
      nicheSlug,
      stack: error.stack
    });
    // Remove new_field from all fields on error
    customTextInputFields.forEach(field => {
      if (field.new_field) {
        delete field.new_field;
      }
    });
  }
}

/**
 * @api {post} /templates Create template
 * @apiVersion 1.0.0
 * @apiName CreateTemplate
 * @apiGroup Templates
 * @apiPermission JWT
 *
 * @apiBody {String} template_name Template name
 * @apiBody {String} template_code Unique template code
 * @apiBody {String} template_output_type Template output type (image, video, audio)
 * @apiBody {String} template_clips_assets_type Template clips assets type (ai, non-ai)
 * @apiBody {String} [template_gender] Template gender (male, female, unisex, couple)
 * @apiBody {String} description Template description
 * @apiBody {String} [prompt] Template prompt (required for image templates)
 * @apiBody {Object} [faces_needed] Required faces configuration
 * @apiBody {String} [cf_r2_key] Template thumbnail R2 key
 * @apiBody {String} [cf_r2_url] Template thumbnail R2 URL
 * @apiBody {String} [color_video_bucket] Color video bucket
 * @apiBody {String} [color_video_key] Color video key
 * @apiBody {String} [mask_video_bucket] Mask video bucket
 * @apiBody {String} [mask_video_key] Mask video key
 * @apiBody {String} [bodymovin_json_bucket] Bodymovin JSON bucket
 * @apiBody {String} [bodymovin_json_key] Bodymovin JSON key
 * @apiBody {Array} [custom_text_input_fields] Custom text input fields
 * @apiBody {Number} [credits=1] Credits required
 * @apiBody {Object} [additional_data] Additional template data
 * @apiBody {Array} clips Template clips array with workflows
 */
exports.createTemplate = async function (req, res) {
  try {
    const templateData = req.validatedBody;
    // Generate UUID for template_id
    templateData.template_id = uuidv7();
    // Default workflow builder to v2
    templateData.workflow_builder_version = templateData.workflow_builder_version || 'v2';

    // Determine template type: respect user input if provided, otherwise auto-detect
    let resolvedClipsAssetsType;

    if (templateData.template_clips_assets_type && templateData.template_clips_assets_type.toLowerCase() === 'ai') {
      // User explicitly specified AI - respect it
      resolvedClipsAssetsType = 'ai';
    } else if (templateData.template_clips_assets_type && templateData.template_clips_assets_type.toLowerCase() === 'non-ai') {
      // User explicitly specified Non-AI - respect it
      resolvedClipsAssetsType = 'non-ai';
    } else {
      // No template type specified - auto-detect based on clips content
      const hasAiModels = templateData.clips && templateData.clips.length > 0 ? hasAiModelsInClips(templateData.clips) : false;
      resolvedClipsAssetsType = hasAiModels ? 'ai' : 'non-ai';
    }

    // Set the resolved type
    templateData.template_clips_assets_type = resolvedClipsAssetsType;

    if (resolvedClipsAssetsType === 'non-ai') {
      // Force non-ai templates to have no clips; counts/upload JSONs populated from Bodymovin in common block below
      templateData.clips = [];
      templateData.faces_needed = [];
      // Calculate credits for non-AI templates based on output type and clips
      templateData.credits = calculateNonAiTemplateCredits(templateData.template_output_type, templateData.clips);

      // When no bodymovin, set upload fields to zero/empty; when bodymovin present they are set from JSON in common block
      const hasBodymovin = templateData.bodymovin_json_key && templateData.bodymovin_json_bucket;
      if (!hasBodymovin) {
        templateData.image_uploads_required = 0;
        templateData.video_uploads_required = 0;
        templateData.image_uploads_json = [];
        templateData.video_uploads_json = [];
        templateData.image_input_fields_json = [];
      }
    } else {
      // AI templates: derive from clips
      if (templateData.clips && templateData.clips.length > 0) {
        templateData.faces_needed = generateFacesNeededFromClips(templateData.clips);
        templateData.image_uploads_required = calculateImageUploadsRequiredFromClips(templateData.clips);
        templateData.video_uploads_required = calculateVideoUploadsRequiredFromClips(templateData.clips);

        // Generate image_uploads_json and video_uploads_json from clips if not provided
        if (!templateData.image_uploads_json) {
          templateData.image_uploads_json = generateImageUploadsJsonFromClips(templateData.clips);
        }
        if (!templateData.video_uploads_json) {
          templateData.video_uploads_json = generateVideoUploadsJsonFromClips(templateData.clips);
        }

        if (!templateData.template_gender) {
          if (templateData.faces_needed && templateData.faces_needed.length === 2) {
            templateData.template_gender = 'couple';
          } else if (templateData.faces_needed && templateData.faces_needed.length === 1) {
            templateData.template_gender = templateData.faces_needed[0].character_gender;
          }
        }

        // Credits: derive minimum from AI models used
        const minimumCredits = await calculateMinimumCreditsFromClips(templateData.clips);
        if (templateData.credits !== undefined && templateData.credits >= minimumCredits) {
          // User provided sufficient credits, use them
          // templateData.credits remains as provided
        } else {
          // User provided insufficient credits or no credits, assign minimum
          templateData.credits = minimumCredits || 1;
        }
      }
    }

    // Calculate aspect ratio, orientation, and total asset counts from bodymovin JSON for ALL templates
    if (templateData.bodymovin_json_key && templateData.bodymovin_json_bucket) {
      try {
        const storage = StorageFactory.getProvider();
        const bodymovinJson = await getBodymovinJson(storage, templateData.bodymovin_json_bucket, templateData.bodymovin_json_key);
        if (bodymovinJson) {

          // Calculate aspect ratio and orientation
          if (bodymovinJson.w && bodymovinJson.h) {
            const { aspectRatio, orientation } = calculateAspectRatioAndOrientation(bodymovinJson.w, bodymovinJson.h);
            templateData.aspect_ratio = aspectRatio;
            templateData.orientation = orientation;
          }

          // Compute total asset counts for ALL templates (AI and non-AI)
          const { total_images_count, total_videos_count, total_texts_count } = computeTotalAssetCountsFromBodymovin(bodymovinJson);
          templateData.total_images_count = total_images_count;
          templateData.total_videos_count = total_videos_count;
          templateData.total_texts_count = total_texts_count;

          // Always populate upload fields from bodymovin JSON
          const { imageCount, videoCount } = computeAssetCountsFromBodymovin(bodymovinJson);
          templateData.image_uploads_required = imageCount;
          templateData.video_uploads_required = videoCount;
          templateData.image_uploads_json = generateImageUploadsJsonFromBodymovin(bodymovinJson);
          templateData.video_uploads_json = generateVideoUploadsJsonFromBodymovin(bodymovinJson);
          const fromBodymovin = generateImageInputFieldsJsonFromBodymovin(bodymovinJson);
          templateData.image_input_fields_json = mergeImageInputFieldsFromRequest(fromBodymovin, templateData.image_input_fields_json);
        }
      } catch (error) {
        logger.warn('Failed to process bodymovin JSON for template', {
          templateId: templateData.template_id,
          error: error.message
        });
        // Set defaults if processing fails
        templateData.total_images_count = templateData.total_images_count || 0;
        templateData.total_videos_count = templateData.total_videos_count || 0;
        templateData.total_texts_count = templateData.total_texts_count || 0;
      }
    } else {
      // No bodymovin JSON provided; default to zero
      templateData.total_images_count = 0;
      templateData.total_videos_count = 0;
      templateData.total_texts_count = 0;
    }

    // Extract clips data and template_tag_ids for transaction
    const clips = templateData.clips;
    const templateTagIds = templateData.template_tag_ids;
    const nicheSlug = templateData.niche_slug; // Extract niche_slug if provided
    delete templateData.clips;
    delete templateData.template_tag_ids;
    delete templateData.niche_slug; // Don't store niche_slug in template

    // Process custom_text_input_fields to handle new fields
    if (templateData.custom_text_input_fields && Array.isArray(templateData.custom_text_input_fields) && nicheSlug) {
      await processNewFieldsWithNicheSlug(templateData.custom_text_input_fields, nicheSlug);
    } else if (templateData.custom_text_input_fields && Array.isArray(templateData.custom_text_input_fields)) {
      // Remove new_field even if no niche_slug (to prevent storing it)
      templateData.custom_text_input_fields.forEach(field => {
        if (field.new_field) {
          delete field.new_field;
        }
      });
    }

    await TemplateModel.createTemplate(templateData, clips);

    // Create template tags if provided
    if (templateTagIds && templateTagIds.length > 0) {
      await TemplateModel.createTemplateTags(templateData.template_id, templateTagIds);
    }

    // Publish activity log command with the UUID template_id
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: {
          admin_user_id: req.user.userId,
          entity_type: 'TEMPLATES',
          action_name: 'ADD_NEW_TEMPLATE',
          entity_id: templateData.template_id
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.CREATED).json({
      message: req.t('template:TEMPLATE_CREATED'),
      data: { template_id: templateData.template_id }
    });

  } catch (error) {
    logger.error('Error creating template:', { error: error.message, stack: error.stack });
    TemplateErrorHandler.handleTemplateErrors(error, res);
  }
};

/**
 * @api {post} /templates/draft Create draft template (minimal)
 * @apiVersion 1.0.0
 * @apiName CreateDraftTemplate
 * @apiGroup Templates
 * @apiPermission JWT
 *
 * @apiBody {String} template_name Template name (required)
 * @apiBody {String} template_code Template code (required)
 * @apiBody {String} cf_r2_url Preview video URL (required)
 * @apiBody {String} cf_r2_key Preview video key (required)
 * @apiBody {String} [template_output_type=video] Template output type
 * @apiBody {String} [status=draft] Template status
 */
exports.createDraftTemplate = async function (req, res) {
  try {
    const templateData = req.validatedBody;

    // Generate UUID for template_id
    templateData.template_id = uuidv7();

    // Set defaults
    templateData.template_output_type = templateData.template_output_type || 'video';
    templateData.template_clips_assets_type = 'non-ai';
    templateData.status = templateData.status || 'draft';
    templateData.template_type = 'premium'; // Default type
    templateData.credits = (templateData?.template_output_type == 'video') ? 50 : 1; // Default credits
    templateData.user_assets_layer = 'bottom'; // Default layer
    templateData.workflow_builder_version = 'v2'; // Hardcoded default for draft

    // Create template in database (minimal data)
    await TemplateModel.createTemplate(templateData, []); // Empty clips array

    // Publish activity log
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: {
          admin_user_id: req.user.userId,
          entity_type: 'TEMPLATES',
          action_name: 'ADD_NEW_TEMPLATE',
          entity_id: templateData.template_id
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.CREATED).json({
      message: req.t('template:TEMPLATE_CREATED'),
      data: { template_id: templateData.template_id }
    });

  } catch (error) {
    logger.error('Error creating draft template:', { error: error.message, stack: error.stack });
    TemplateErrorHandler.handleTemplateErrors(error, res);
  }
};

/**
 * Generate faces_needed array from clips data
 * @param {Array} clips - Array of clip objects with workflows
 * @returns {Array} Array of unique faces needed
 */
function generateFacesNeededFromClips(clips) {
  if (!clips || !Array.isArray(clips) || clips.length === 0) {
    logger.info('generateFacesNeededFromClips: No clips provided, returning empty array');
    return [];
  }

  logger.info('generateFacesNeededFromClips: Starting with clips', { clipsCount: clips.length });

  // Collect genders from any workflow step data items with type 'character_gender' (or legacy 'gender')
  const gendersSet = new Set();

  clips.forEach((clip, clipIndex) => {
    if (!clip || !Array.isArray(clip.workflow)) return;

    clip.workflow.forEach((workflowStep, stepIndex) => {
      if (!workflowStep || !Array.isArray(workflowStep.data)) return;

      // Only process "generate image" type nodes (not upload nodes)
      const workflowCode = (workflowStep.workflow_code ? String(workflowStep.workflow_code) : '').toLowerCase().trim();
      const workflowId = (workflowStep.workflow_id ? String(workflowStep.workflow_id) : '').toLowerCase().trim();

      // Check if this is a "generate image" type node
      const isGenerateImageByCode = workflowCode === 'multi_image_editing' ||
        workflowCode === 'style_change_convert_image' ||
        workflowCode === 'image_generation' ||
        workflowCode === 'generate_image' ||
        workflowCode === 'image_editing' ||
        workflowCode === 'inpainting' ||
        workflowCode === 'inpaint_one_character';
      const isGenerateImageById = workflowId === 'multi-image-editing' ||
        workflowId === 'style-change' ||
        workflowId === 'image-generation' ||
        workflowId === 'generate-image' ||
        workflowId === 'image-editing' ||
        workflowId === 'inpainting' ||
        workflowId === 'inpaint-one-character';

      const isGenerateImageStep = isGenerateImageByCode || isGenerateImageById;

      if (isGenerateImageStep) {
        logger.info('generateFacesNeededFromClips: Found generate image step', {
          clipIndex,
          stepIndex,
          workflowCode,
          workflowId
        });

        for (const item of workflowStep.data) {
          if (!item || !item.type) continue;

          const itemType = String(item.type).toLowerCase().trim();
          if (itemType === 'character_gender' || itemType === 'gender') {
            const value = (item.value ?? '').toString().toLowerCase().trim();

            if (!value) {
              logger.warn('Skipping empty character gender value', { clipIndex, stepIndex });
              continue;
            }

            // Normalize and validate
            if (value === 'male' || value === 'female') {
              gendersSet.add(value);
            } else if (value === 'unisex') {
              gendersSet.add('unisex');
            } else if (value === 'couple') {
              // Interpret 'couple' as requiring both male and female faces
              gendersSet.add('male');
              gendersSet.add('female');
            } else {
              logger.warn('Skipping unsupported character gender', { clipIndex, stepIndex, value });
            }
          }
        }
      }
    });
  });

  // Decide faces needed based on distinct character slots required across the template
  const requireMale = gendersSet.has('male') || gendersSet.has('couple');
  const requireFemale = gendersSet.has('female') || gendersSet.has('couple');
  const requireUnisex = gendersSet.has('unisex');

  const facesNeeded = [];

  // Keep a stable order: female, male, unisex
  if (requireFemale) {
    facesNeeded.push({ character_name: 'Character 1', character_gender: 'female' });
  }
  if (requireMale) {
    facesNeeded.push({ character_name: `Character ${facesNeeded.length + 1}`, character_gender: 'male' });
  }
  if (requireUnisex) {
    // If neither male nor female is specifically required, a single unisex character is sufficient
    if (!requireMale && !requireFemale) {
      facesNeeded.push({ character_name: 'Character 1', character_gender: 'unisex' });
    } else {
      // Otherwise, add an additional flexible slot
      facesNeeded.push({ character_name: `Character ${facesNeeded.length + 1}`, character_gender: 'unisex' });
    }
  }

  // Attach stable unique ids for each character slot
  const facesWithIds = facesNeeded.map((face, index) => {
    const id = uuidv7();
    return {
      ...face,
      template_character_id: id,
      character_id: id
    };
  });

  logger.info('generateFacesNeededFromClips: Generated faces_needed from clips', {
    totalClips: clips.length,
    genders: Array.from(gendersSet),
    facesNeeded: facesWithIds
  });

  return facesWithIds;
}

/**
 * Calculate how many user image uploads are required based on workflow steps
 * Counts occurrences of a step asking the user to upload an image
 * Recognizes by workflow_code 'ask_user_to_upload_image' or workflow_id 'user-upload-image'
 * @param {Array} clips
 * @returns {number}
 */
function calculateImageUploadsRequiredFromClips(clips) {
  if (!Array.isArray(clips)) {
    return 0;
  }

  let uploads = 0;

  for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
    const clip = clips[clipIndex];
    if (!clip || !Array.isArray(clip.workflow)) {
      continue;
    }

    for (let stepIndex = 0; stepIndex < clip.workflow.length; stepIndex++) {
      const step = clip.workflow[stepIndex];
      const workflowCode = (step && step.workflow_code ? String(step.workflow_code) : '').toLowerCase().trim();
      const workflowId = (step && step.workflow_id ? String(step.workflow_id) : '').toLowerCase().trim();

      const isAskUploadByCode = workflowCode === 'ask_user_to_upload_image' || workflowCode === 'ask-user-to-upload-image' || workflowCode === 'ask_user_upload_image';
      const isAskUploadById = workflowId === 'user-upload-image' || workflowId === 'user_upload_image';

      if (isAskUploadByCode || isAskUploadById) {
        uploads += 1;
      }
    }
  }

  return uploads;
}

/**
 * Calculate how many user video uploads are required based on workflow steps
 * Counts occurrences of a step asking the user to upload a video
 * Recognizes by workflow_code 'ask_user_to_upload_video' or workflow_id 'user-upload-video'
 * @param {Array} clips
 * @returns {number}
 */
function calculateVideoUploadsRequiredFromClips(clips) {
  if (!Array.isArray(clips)) {
    return 0;
  }

  let uploads = 0;

  for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
    const clip = clips[clipIndex];
    if (!clip || !Array.isArray(clip.workflow)) {
      continue;
    }

    for (let stepIndex = 0; stepIndex < clip.workflow.length; stepIndex++) {
      const step = clip.workflow[stepIndex];
      const workflowCode = (step && step.workflow_code ? String(step.workflow_code) : '').toLowerCase().trim();
      const workflowId = (step && step.workflow_id ? String(step.workflow_id) : '').toLowerCase().trim();

      const isAskUploadByCode = workflowCode === 'ask_user_to_upload_video' || workflowCode === 'ask-user-to-upload-video' || workflowCode === 'ask_user_upload_video';
      const isAskUploadById = workflowId === 'user-upload-video' || workflowId === 'user_upload_video';

      if (isAskUploadByCode || isAskUploadById) {
        uploads += 1;
      }
    }
  }

  return uploads;
}

/**
 * Generate image_uploads_json from clips data
 * Extracts upload steps with gender information for image uploads
 * @param {Array} clips - Array of clip objects with workflows
 * @returns {Array} Array of image upload objects with clip_index, step_index, and gender
 */
function generateImageUploadsJsonFromClips(clips) {
  if (!clips || !Array.isArray(clips) || clips.length === 0) {
    logger.info('generateImageUploadsJsonFromClips: No clips provided, returning empty array');
    return [];
  }

  logger.info('generateImageUploadsJsonFromClips: Starting with clips', { clipsCount: clips.length });

  const imageUploads = [];

  clips.forEach((clip, clipIndex) => {
    if (!clip || !Array.isArray(clip.workflow)) return;

    clip.workflow.forEach((workflowStep, stepIndex) => {
      if (!workflowStep || !Array.isArray(workflowStep.data)) return;

      const workflowCode = (workflowStep.workflow_code ? String(workflowStep.workflow_code) : '').toLowerCase().trim();
      const workflowId = (workflowStep.workflow_id ? String(workflowStep.workflow_id) : '').toLowerCase().trim();

      const isAskUploadByCode = workflowCode === 'ask_user_to_upload_image' || workflowCode === 'ask-user-to-upload-image' || workflowCode === 'ask_user_upload_image';
      const isAskUploadById = workflowId === 'user-upload-image' || workflowId === 'user_upload_image';

      if (isAskUploadByCode || isAskUploadById) {
        logger.info('generateImageUploadsJsonFromClips: Found image upload step', {
          clipIndex,
          stepIndex,
          workflowCode,
          workflowId
        });

        // Look for gender information in the step data
        let gender = 'unisex'; // Default gender

        for (const item of workflowStep.data) {
          if (!item || !item.type) continue;

          const itemType = String(item.type).toLowerCase().trim();
          if (itemType === 'character_gender' || itemType === 'gender') {
            const value = (item.value ?? '').toString().toLowerCase().trim();

            if (value === 'male' || value === 'female' || value === 'unisex' || value === 'couple') {
              gender = value;
              break;
            }
          }
        }

        imageUploads.push({
          clip_index: clipIndex + 1, // 1-based indexing
          step_index: stepIndex,
          gender: gender
        });
      }
    });
  });

  logger.info('generateImageUploadsJsonFromClips: Generated image uploads', {
    clipsCount: clips.length,
    imageUploads: imageUploads
  });

  return imageUploads;
}

/**
 * Generate video_uploads_json from clips data
 * Extracts upload steps with gender information for video uploads
 * @param {Array} clips - Array of clip objects with workflows
 * @returns {Array} Array of video upload objects with clip_index, step_index, and gender
 */
function generateVideoUploadsJsonFromClips(clips) {
  if (!clips || !Array.isArray(clips) || clips.length === 0) {
    logger.info('generateVideoUploadsJsonFromClips: No clips provided, returning empty array');
    return [];
  }

  logger.info('generateVideoUploadsJsonFromClips: Starting with clips', { clipsCount: clips.length });

  const videoUploads = [];

  clips.forEach((clip, clipIndex) => {
    if (!clip || !Array.isArray(clip.workflow)) return;

    clip.workflow.forEach((workflowStep, stepIndex) => {
      if (!workflowStep || !Array.isArray(workflowStep.data)) return;

      const workflowCode = (workflowStep.workflow_code ? String(workflowStep.workflow_code) : '').toLowerCase().trim();
      const workflowId = (workflowStep.workflow_id ? String(workflowStep.workflow_id) : '').toLowerCase().trim();

      const isAskUploadByCode = workflowCode === 'ask_user_to_upload_video' || workflowCode === 'ask-user-to-upload-video' || workflowCode === 'ask_user_upload_video';
      const isAskUploadById = workflowId === 'user-upload-video' || workflowId === 'user_upload_video';

      if (isAskUploadByCode || isAskUploadById) {
        logger.info('generateVideoUploadsJsonFromClips: Found video upload step', {
          clipIndex,
          stepIndex,
          workflowCode,
          workflowId
        });

        // Look for gender information in the step data
        let gender = 'unisex'; // Default gender

        for (const item of workflowStep.data) {
          if (!item || !item.type) continue;

          const itemType = String(item.type).toLowerCase().trim();
          if (itemType === 'character_gender' || itemType === 'gender') {
            const value = (item.value ?? '').toString().toLowerCase().trim();

            if (value === 'male' || value === 'female' || value === 'unisex' || value === 'couple') {
              gender = value;
              break;
            }
          }
        }

        videoUploads.push({
          clip_index: clipIndex + 1, // 1-based indexing
          step_index: stepIndex,
          gender: gender
        });
      }
    });
  });

  logger.info('generateVideoUploadsJsonFromClips: Generated video uploads', {
    clipsCount: clips.length,
    videoUploads: videoUploads
  });

  return videoUploads;
}

/**
 * Compute image and video asset counts from a Bodymovin (Lottie) JSON
 * - Images are typically referenced in `assets` with ids like image_*
 * - Video layers can be inferred from layers with ty === 9 (Lottie video), if present
 */
function computeAssetCountsFromBodymovin(bodymovinJson) {
  try {
    const assets = Array.isArray(bodymovinJson?.assets) ? bodymovinJson.assets : [];
    const layers = Array.isArray(bodymovinJson?.layers) ? bodymovinJson.layers : [];

    // Count images by asset entries that look like images (presence of `p` with common image extension)
    const imageCount = assets.filter(a => {
      if (!a || typeof a.id !== 'string' || !a.p) return false;
      const name = String(a.p).toLowerCase();
      return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp');
    }).length;

    // Lottie spec: video layers are type 9 (rare). If not present, default to 0
    const videoCount = layers.filter(l => l && Number(l.ty) === 9).length;

    return { imageCount, videoCount };
  } catch (_e) {
    return { imageCount: 0, videoCount: 0 };
  }
}

/**
 * Recursively count text layers in Lottie JSON structure
 * @param {Array} layers - Array of layers
 * @returns {number} - Total count of text layers
 */
function countTextLayers(layers) {
  if (!Array.isArray(layers)) return 0;

  let count = 0;
  for (const layer of layers) {
    if (!layer) continue;

    // Lottie layer type 5 is text
    if (Number(layer.ty) === 5) {
      count++;
    }

    // Recursively check nested layers (precomps, etc.)
    if (Array.isArray(layer.layers)) {
      count += countTextLayers(layer.layers);
    }
  }

  return count;
}

/**
 * Compute total assets counts from a Bodymovin (Lottie) JSON
 * This includes all images, videos, and text layers in the entire template
 * @param {Object} bodymovinJson - The Bodymovin JSON object
 * @returns {Object} - Object containing total_images_count, total_videos_count, total_texts_count
 */
function computeTotalAssetCountsFromBodymovin(bodymovinJson) {
  try {
    const assets = Array.isArray(bodymovinJson?.assets) ? bodymovinJson.assets : [];
    const layers = Array.isArray(bodymovinJson?.layers) ? bodymovinJson.layers : [];

    // Count total images from assets (all image types)
    const totalImagesCount = assets.filter(a => {
      if (!a || typeof a.id !== 'string') return false;
      // Check if it's an image asset by presence of 'p' property with image extension
      if (a.p) {
        const name = String(a.p).toLowerCase();
        return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp') || name.endsWith('.gif');
      }
      // Also check for embedded images (have w, h, and e properties)
      return a.w && a.h && (a.e === 1 || a.e === 0);
    }).length;

    // Count total videos from layers (Lottie layer type 9 is video)
    const totalVideosCount = layers.filter(l => l && Number(l.ty) === 9).length;

    // Count total text layers (Lottie layer type 5 is text)
    const totalTextsCount = countTextLayers(layers);

    return {
      total_images_count: totalImagesCount,
      total_videos_count: totalVideosCount,
      total_texts_count: totalTextsCount
    };
  } catch (error) {
    logger.error('Error computing total asset counts from Bodymovin', { error: error.message });
    return { total_images_count: 0, total_videos_count: 0, total_texts_count: 0 };
  }
}

/**
 * Generate image_uploads_json from Bodymovin (Lottie) JSON
 * One entry per image asset: { clip_index: 1, step_index, gender: 'unisex' }
 * @param {Object} bodymovinJson - Parsed Bodymovin JSON
 * @returns {Array}
 */
function generateImageUploadsJsonFromBodymovin(bodymovinJson) {
  try {
    const assets = Array.isArray(bodymovinJson?.assets) ? bodymovinJson.assets : [];
    const imageAssets = assets.filter(a => {
      if (!a || typeof a.id !== 'string' || !a.p) return false;
      const name = String(a.p).toLowerCase();
      return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp');
    });
    return imageAssets.map((_, index) => ({
      clip_index: 1,
      step_index: index,
      gender: 'unisex'
    }));
  } catch (_e) {
    return [];
  }
}

/**
 * Generate video_uploads_json from Bodymovin (Lottie) JSON
 * One entry per video layer (ty === 9): { clip_index: 1, step_index, gender: 'unisex' }
 * @param {Object} bodymovinJson - Parsed Bodymovin JSON
 * @returns {Array}
 */
function generateVideoUploadsJsonFromBodymovin(bodymovinJson) {
  try {
    const layers = Array.isArray(bodymovinJson?.layers) ? bodymovinJson.layers : [];
    const videoLayers = layers.filter(l => l && Number(l.ty) === 9);
    return videoLayers.map((_, index) => ({
      clip_index: 1,
      step_index: index,
      gender: 'unisex'
    }));
  } catch (_e) {
    return [];
  }
}

/**
 * Generate image_input_fields_json from Bodymovin (Lottie) JSON
 * One entry per image asset: { image_id, layer_name, field_code, user_input_field_name, field_data_type: 'photo' }
 * Uses field_code like image_0, image_1 by default; UI can send bride_photo, groom_photo etc. and we merge when lengths match.
 * @param {Object} bodymovinJson - Parsed Bodymovin JSON
 * @returns {Array}
 */
function generateImageInputFieldsJsonFromBodymovin(bodymovinJson) {
  try {
    const assets = Array.isArray(bodymovinJson?.assets) ? bodymovinJson.assets : [];
    const imageAssets = assets.filter(a => {
      if (!a || typeof a.id !== 'string' || !a.p) return false;
      const name = String(a.p).toLowerCase();
      return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp');
    });
    return imageAssets.map((a, index) => ({
      image_id: String(a.id),
      layer_name: a.nm || a.p || String(a.id),
      field_code: `image_${index}`,
      user_input_field_name: null,
      field_data_type: 'photo'
    }));
  } catch (_e) {
    return [];
  }
}

/**
 * Merge UI-provided field_code and user_input_field_name into bodymovin-generated image_input_fields_json.
 * When request sent image_input_fields_json with same length (e.g. bride_photo, groom_photo), preserve those fields.
 * @param {Array} fromBodymovin - Array from generateImageInputFieldsJsonFromBodymovin
 * @param {Array} fromRequest - templateData.image_input_fields_json from request (may be undefined)
 * @returns {Array} Merged array; fromBodymovin unchanged if lengths differ or fromRequest not an array
 */
function mergeImageInputFieldsFromRequest(fromBodymovin, fromRequest) {
  if (!Array.isArray(fromRequest) || fromRequest.length !== fromBodymovin.length) {
    return fromBodymovin;
  }
  return fromBodymovin.map((entry, i) => {
    const req = fromRequest[i];
    return {
      ...entry,
      field_code: (req && req.field_code != null && req.field_code !== '') ? req.field_code : entry.field_code,
      user_input_field_name: (req && req.user_input_field_name != null) ? req.user_input_field_name : entry.user_input_field_name,
      reference_image: (req && req.reference_image != null) ? req.reference_image : entry.reference_image,
      variable_key: (req && (req.variable_key != null && req.variable_key !== '')) ? req.variable_key : entry.variable_key,
      label: (req && (req.label != null && req.label !== '')) ? req.label : entry.label,
      clip_index: (req && req.clip_index != null) ? req.clip_index : entry.clip_index
    };
  });
}

/**
 * Extract all AI model occurrences from clips for cost calculation
 * Returns array of model occurrences with context (clip, step, quality, duration)
 * @param {Array} clips
 * @returns {Array<Object>}
 */
function extractAiModelOccurrencesFromClips(clips) {
  const modelOccurrences = [];

  for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
    const clip = clips[clipIndex];
    if (!clip || !Array.isArray(clip.workflow)) continue;

    for (let stepIndex = 0; stepIndex < clip.workflow.length; stepIndex++) {
      const step = clip.workflow[stepIndex];
      if (!step || !Array.isArray(step.data)) continue;

      let modelId = null;
      let videoQuality = null;
      let videoDuration = null;
      let prompt = null;

      // Extract model ID and context from step data
      for (const item of step.data) {
        if (item && item.type === 'ai_model' && item.value) {
          modelId = item.value;
        } else if (item && item.type === 'video_quality' && item.value) {
          videoQuality = item.value;
        } else if (item && item.type === 'video_duration' && item.value) {
          videoDuration = item.value;
        } else if (item && item.type === 'prompt' && item.value) {
          prompt = item.value;
        }
      }

      if (modelId) {
        modelOccurrences.push({
          modelId,
          clipIndex,
          stepIndex,
          videoQuality,
          videoDuration,
          prompt: prompt ? prompt.substring(0, 100) + '...' : null, // Truncate for logging
          workflowCode: step.workflow_code,
          workflowId: step.workflow_id
        });
      }
    }
  }

  return modelOccurrences;
}

/**
 * Extract unique AI model IDs from clips for database lookup
 * @param {Array} clips
 * @returns {Array<string>}
 */
function extractAiModelIdsFromClips(clips) {
  const occurrences = extractAiModelOccurrencesFromClips(clips);
  const uniqueIds = [...new Set(occurrences.map(occ => occ.modelId))];
  return uniqueIds;
}

/**
 * Check if clips contain any AI models
 * @param {Array} clips - Template clips array
 * @returns {boolean} - True if clips contain AI models
 */
function hasAiModelsInClips(clips) {
  if (!clips || clips.length === 0) {
    return false;
  }

  for (const clip of clips) {
    if (clip.workflow && Array.isArray(clip.workflow)) {
      for (const step of clip.workflow) {
        if (step.model_id) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Calculate credits for non-AI templates based on output type and clips
 * @param {string} outputType - Template output type (image, video, audio)
 * @param {Array} clips - Template clips array
 * @returns {number} - Credits required
 */
function calculateNonAiTemplateCredits(outputType, clips) {
  const baseCredits = outputType === 'video' ? TEMPLATE_CONSTANTS.NON_AI_VIDEO_BASE_CREDITS : TEMPLATE_CONSTANTS.NON_AI_IMAGE_BASE_CREDITS;

  // For videos, add 0.003 USD per clip
  if (outputType === 'video' && clips && clips.length > 0) {
    // Add 0.003 USD per clip (0.15 credits per clip at $0.02 per credit)
    const additionalCredits = Math.ceil((clips.length * 0.003) / TEMPLATE_CONSTANTS.USD_PER_CREDIT);
    return baseCredits + additionalCredits;
  }

  return baseCredits;
}

/**
 * Calculate credits based on actual model usage occurrences and their costs
 * Each model usage is calculated individually with proper quality/duration pricing
 */
async function calculateMinimumCreditsFromClips(clips) {
  const modelOccurrences = extractAiModelOccurrencesFromClips(clips);

  if (modelOccurrences.length === 0) {
    return 0;
  }

  // Get unique model IDs for database lookup
  const uniqueModelIds = [...new Set(modelOccurrences.map(occ => occ.modelId))];

  const aiModels = await AiModelModel.getAiModelsByPlatformModelIds(uniqueModelIds);

  // Create a map for quick model lookup using platform_model_id
  const modelMap = new Map();
  for (const model of aiModels) {
    // Map by platform_model_id since that's what's used in clips
    modelMap.set(model.platform_model_id, model);
    // Also map by model_id for backward compatibility
    modelMap.set(model.model_id, model);
  }

  let totalUsd = 0;
  const occurrenceBreakdown = [];

  // Calculate cost for each model occurrence
  for (const occurrence of modelOccurrences) {
    const model = modelMap.get(occurrence.modelId);

    if (!model) {
      const fallbackUsd = TEMPLATE_CONSTANTS.DEFAULT_MODEL_INVOCATION_USD;
      totalUsd += fallbackUsd;
      occurrenceBreakdown.push({
        ...occurrence,
        modelFound: false,
        costUsd: fallbackUsd,
        reason: 'Model not found in database'
      });
      continue;
    }

    if (model.status !== 'active') {
      const fallbackUsd = TEMPLATE_CONSTANTS.DEFAULT_MODEL_INVOCATION_USD;
      totalUsd += fallbackUsd;
      occurrenceBreakdown.push({
        ...occurrence,
        modelFound: true,
        modelStatus: model.status,
        costUsd: fallbackUsd,
        reason: 'Model inactive'
      });
      continue;
    }

    const costs = normalizeCosts(model.costs);
    const occurrenceCost = calculateOccurrenceCost(occurrence, costs, model);

    totalUsd += occurrenceCost;
    occurrenceBreakdown.push({
      ...occurrence,
      modelFound: true,
      modelStatus: model.status,
      costUsd: occurrenceCost,
      costs: costs,
      reason: 'Calculated from model costs'
    });
  }

  // Convert USD to credits; ceil to ensure sufficient credits
  const credits = Math.ceil(totalUsd / TEMPLATE_CONSTANTS.USD_PER_CREDIT);
  const finalCredits = Math.max(1, credits);

  console.log('\n--- CREDITS CALCULATION SUMMARY ---');
  console.log('Total USD cost:', totalUsd);
  console.log('USD per credit:', TEMPLATE_CONSTANTS.USD_PER_CREDIT);
  console.log('Calculated credits (before min):', credits);
  console.log('Final credits (min 1):', finalCredits);
  console.log('Occurrence breakdown:', occurrenceBreakdown);
  console.log('=== END CREDITS ANALYSIS ===\n');

  return finalCredits;
}

/**
 * Calculate the cost for a specific model occurrence based on its context
 * @param {Object} occurrence - The model occurrence with quality, duration, etc.
 * @param {Object} costs - The normalized costs from the model
 * @param {Object} model - The full model object from database
 * @returns {number} - Cost in USD
 */
function calculateOccurrenceCost(occurrence, costs, model) {
  let totalCost = 0;

  // Handle input costs (text, image)
  if (costs.input) {
    // Text input cost
    if (costs.input.text && occurrence.workflowCode !== 'static-image') {
      totalCost += costs.input.text;
    }

    // Image input cost (per megapixel)
    if (costs.input.image && costs.input.image.per_megapixel) {
      const imageCost = costs.input.image.per_megapixel * TEMPLATE_CONSTANTS.DEFAULT_IMAGE_MEGAPIXELS;
      totalCost += imageCost;
    }
  }

  // Handle output costs
  if (costs.output) {
    // Image output cost
    if (costs.output.image && costs.output.image.per_megapixel) {
      const imageCost = costs.output.image.per_megapixel * TEMPLATE_CONSTANTS.DEFAULT_IMAGE_MEGAPIXELS;
      totalCost += imageCost;
    }

    // Video output cost
    if (costs.output.video) {
      const videoCost = calculateVideoOutputCost(occurrence, costs.output.video);
      totalCost += videoCost;
    }

    // Audio output cost
    if (costs.output.audio && costs.output.audio.price && costs.output.audio.seconds) {
      const audioCost = costs.output.audio.price;
      totalCost += audioCost;
    }
  }

  return totalCost;
}

/**
 * Calculate video output cost based on quality and duration
 * @param {Object} occurrence - The model occurrence
 * @param {Object} videoCosts - The video costs from the model
 * @returns {number} - Cost in USD
 */
function calculateVideoOutputCost(occurrence, videoCosts) {
  const quality = occurrence.videoQuality || '720p'; // Default quality
  const duration = occurrence.videoDuration || '5s'; // Default duration

  if (!videoCosts[quality]) {
    const availableQualities = Object.keys(videoCosts);
    if (availableQualities.length === 0) return 0;
    const fallbackQuality = availableQualities[0];
    return calculateVideoCostForQuality(duration, videoCosts[fallbackQuality]);
  }

  return calculateVideoCostForQuality(duration, videoCosts[quality]);
}

/**
 * Calculate video cost for a specific quality and duration
 * @param {string} duration - Video duration (e.g., "5s")
 * @param {Object} qualityCosts - The costs for this quality
 * @returns {number} - Cost in USD
 */
function calculateVideoCostForQuality(duration, qualityCosts) {
  // Parse duration (e.g., "5s" -> 5)
  const durationSeconds = parseInt(duration.replace('s', '')) || 5;

  // Try per_segment pricing first (most common)
  if (qualityCosts.per_segment) {
    const segmentKey = duration; // e.g., "5s"
    if (qualityCosts.per_segment[segmentKey]) {
      const cost = qualityCosts.per_segment[segmentKey];
      return cost;
    }

    // Try 5s segment as fallback
    if (qualityCosts.per_segment['5s']) {
      const cost = qualityCosts.per_segment['5s'];
      return cost;
    }
  }

  // Try per_second pricing
  if (qualityCosts.per_second) {
    const cost = qualityCosts.per_second * durationSeconds;
    return cost;
  }

  return 0;
}

function normalizeCosts(costs) {
  if (!costs) return {};
  try {
    return typeof costs === 'string' ? JSON.parse(costs) : costs;
  } catch (_e) {
    return {};
  }
}

// Heuristic: choose the cheapest available pricing path for a model
function estimateMinimumUsdPerInvocation(costs) {
  if (!costs || typeof costs !== 'object') return 0;

  let minUsd = Infinity;

  // Consider input flat costs (e.g., text: 0.02)
  if (costs.input && typeof costs.input === 'object') {
    for (const inputType of Object.keys(costs.input)) {
      const val = costs.input[inputType];
      // Case A: cost is a flat number
      if (typeof val === 'number') {
        minUsd = Math.min(minUsd, val);
        continue;
      }
      // Case B: image input with per_megapixel pricing
      if (val && typeof val === 'object') {
        const perMp = Number(val.per_megapixel);
        if (Number.isFinite(perMp)) {
          const assumedMp = TEMPLATE_CONSTANTS.DEFAULT_IMAGE_MEGAPIXELS;
          minUsd = Math.min(minUsd, perMp * assumedMp);
        }
      }
    }
  }

  // Consider output costs: image per_megapixel, video qualities per_segment or per_second
  if (costs.output && typeof costs.output === 'object') {
    for (const outputType of Object.keys(costs.output)) {
      const typeCosts = costs.output[outputType];
      if (!typeCosts || typeof typeCosts !== 'object') continue;
      // Image output: per_megapixel
      if (outputType === 'image' && typeCosts && typeof typeCosts === 'object') {
        const perMp = Number(typeCosts.per_megapixel);
        if (Number.isFinite(perMp)) {
          const assumedMp = TEMPLATE_CONSTANTS.DEFAULT_IMAGE_MEGAPIXELS;
          minUsd = Math.min(minUsd, perMp * assumedMp);
        }
      }
      // Video output: qualities
      for (const quality of Object.keys(typeCosts)) {
        const q = typeCosts[quality];
        if (!q || typeof q !== 'object') continue;
        const perSegment = q.per_segment && typeof q.per_segment['5s'] === 'number' ? q.per_segment['5s'] : undefined;
        const perSecond = typeof q.per_second === 'number' ? q.per_second * TEMPLATE_CONSTANTS.DEFAULT_VIDEO_SEGMENT_SECONDS : undefined;
        const candidate = Math.min(
          perSegment !== undefined ? perSegment : Infinity,
          perSecond !== undefined ? perSecond : Infinity
        );
        if (Number.isFinite(candidate)) {
          minUsd = Math.min(minUsd, candidate);
        }
      }
    }
  }

  if (!Number.isFinite(minUsd)) return 0;
  return Math.max(0, minUsd);
}

function ensureCreditsSatisfyMinimum(clientProvidedCredits, minimumCredits, translatorFn) {
  console.log("===============")
  console.log(clientProvidedCredits, minimumCredits, 'clientProvidedCredits, minimumCredits')
  console.log("===============")
  const parsedCredits = Number(clientProvidedCredits);
  if (!Number.isFinite(parsedCredits) || parsedCredits < minimumCredits) {
    const message = translatorFn('template:CREDITS_INSUFFICIENT', {
      minimumCreditsRequired: minimumCredits,
      providedCredits: Number.isFinite(parsedCredits) ? parsedCredits : 0
    });
    const error = new Error(message);
    error.httpStatusCode = 400;
    error.code = 'CREDITS_INSUFFICIENT';
    error.details = { minimumCreditsRequired: minimumCredits, providedCredits: parsedCredits };
    throw error;
  }
}

/**
 * @api {patch} /templates/:templateId Update template
 * @apiVersion 1.0.0
 * @apiName UpdateTemplate
 * @apiGroup Templates
 * @apiPermission JWT
 *
 * @apiParam {String} templateId Template ID
 * @apiBody {String} [template_name] Template name
 * @apiBody {String} [template_code] Unique template code
 * @apiBody {String} [template_output_type] Template output type (image, video, audio)
 * @apiBody {String} [template_clips_assets_type] Template clips assets type (ai, non-ai)
 * @apiBody {String} [template_gender] Template gender (male, female, unisex, couple)
 * @apiBody {String} [description] Template description
 * @apiBody {String} [prompt] Template prompt
 * @apiBody {Object} [faces_needed] Required faces configuration
 * @apiBody {String} [cf_r2_key] Template thumbnail R2 key
 * @apiBody {String} [cf_r2_url] Template thumbnail R2 URL
 * @apiBody {String} [color_video_bucket] Color video bucket
 * @apiBody {String} [color_video_key] Color video key
 * @apiBody {String} [mask_video_bucket] Mask video bucket
 * @apiBody {String} [mask_video_key] Mask video key
 * @apiBody {String} [bodymovin_json_bucket] Bodymovin JSON bucket
 * @apiBody {String} [bodymovin_json_key] Bodymovin JSON key
 * @apiBody {Array} [custom_text_input_fields] Custom text input fields
 * @apiBody {Number} [credits] Credits required
 * @apiBody {Object} [additional_data] Additional template data
 * @apiBody {Array} [clips] Template clips array with workflows
 */
exports.updateTemplate = async function (req, res) {
  try {
    const { templateId } = req.params;
    const templateData = req.validatedBody;

    // Check if template exists and get current template info
    const existingTemplate = await TemplateModel.getTemplateById(templateId);
    if (!existingTemplate) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template:TEMPLATE_NOT_FOUND')
      });
    }

    // Check if template_code is being updated and if it already exists for another template
    if (templateData.template_code && templateData.template_code !== existingTemplate.template_code) {
      const templateWithSameCode = await TemplateModel.getTemplateByCode(templateData.template_code);
      if (templateWithSameCode && templateWithSameCode.template_id !== templateId) {
        return res.status(HTTP_STATUS_CODES.CONFLICT).json({
          message: req.t('template:TEMPLATE_CODE_EXISTS')
        });
      }
    }

    // Determine template type: respect user input if provided, otherwise auto-detect
    let resolvedClipsAssetsType;

    if (templateData.template_clips_assets_type && templateData.template_clips_assets_type.toLowerCase() === 'ai') {
      // User explicitly specified AI - respect it
      resolvedClipsAssetsType = 'ai';
    } else if (templateData.template_clips_assets_type && templateData.template_clips_assets_type.toLowerCase() === 'non-ai') {
      // User explicitly specified Non-AI - respect it
      resolvedClipsAssetsType = 'non-ai';
    } else {
      // No template type specified - auto-detect based on clips content
      const hasAiModels = templateData.clips && templateData.clips.length > 0 ? hasAiModelsInClips(templateData.clips) : false;
      resolvedClipsAssetsType = hasAiModels ? 'ai' : 'non-ai';
    }

    const isNonAi = resolvedClipsAssetsType === 'non-ai';

    // Set the resolved type
    templateData.template_clips_assets_type = resolvedClipsAssetsType;

    logger.info('UpdateTemplate resolved template_clips_assets_type', { templateId, resolvedClipsAssetsType, userProvided: templateData.template_clips_assets_type });

    // If template is non-ai, always overwrite clips to empty and cleanup any existing AI clips
    if (isNonAi) {
      templateData.clips = [];
      templateData.faces_needed = [];
      // Calculate credits for non-AI templates based on output type and clips
      templateData.credits = calculateNonAiTemplateCredits(templateData.template_output_type || existingTemplate.template_output_type, templateData.clips);

      // Ensure any previously saved AI clips are deleted
      try {
        await TemplateModel.deleteTemplateAiClips(templateId);
      } catch (cleanupError) {
        logger.warn('Failed to cleanup AI clips for non-ai template update', { templateId, error: cleanupError.message });
      }

      // When no bodymovin, set upload fields to zero/empty; when bodymovin present they are set from JSON in common block below
      const key = templateData.bodymovin_json_key || existingTemplate.bodymovin_json_key;
      const bucket = templateData.bodymovin_json_bucket || existingTemplate.bodymovin_json_bucket;
      if (!key || !bucket) {
        templateData.image_uploads_required = 0;
        templateData.video_uploads_required = 0;
        templateData.image_uploads_json = [];
        templateData.video_uploads_json = [];
        templateData.image_input_fields_json = [];
      }
    }

    // Handle faces_needed for all template types
    const hasClips = templateData.clips && templateData.clips.length > 0;

    if (hasClips) {
      // Generate faces_needed from clips data when clips are provided
      templateData.faces_needed = generateFacesNeededFromClips(templateData.clips);

      // Recompute uploads required when clips are provided
      templateData.image_uploads_required = calculateImageUploadsRequiredFromClips(templateData.clips);
      templateData.video_uploads_required = calculateVideoUploadsRequiredFromClips(templateData.clips);

      // Generate image_uploads_json and video_uploads_json from clips if not provided
      if (!templateData.image_uploads_json) {
        templateData.image_uploads_json = generateImageUploadsJsonFromClips(templateData.clips);
      }
      if (!templateData.video_uploads_json) {
        templateData.video_uploads_json = generateVideoUploadsJsonFromClips(templateData.clips);
      }

      // faces_needed derived from clips; retained for debugging via structured logs if needed
      // Auto-derive template_gender if not explicitly provided in update
      if (templateData.template_gender === undefined) {
        if (templateData.faces_needed && templateData.faces_needed.length === 2) {
          templateData.template_gender = 'couple';
        } else if (templateData.faces_needed && templateData.faces_needed.length === 1) {
          templateData.template_gender = templateData.faces_needed[0].character_gender;
        }
      }

      // Credits: always calculate minimum from AI models used for updates with clips
      const minimumCredits = await calculateMinimumCreditsFromClips(templateData.clips);

      if (templateData.credits !== undefined && templateData.credits >= minimumCredits) {
        // User provided sufficient credits, use them
      } else {
        // User provided insufficient credits or no credits, always assign calculated minimum
        templateData.credits = minimumCredits || 1;
      }
    } else if (templateData.clips !== undefined) {
      // If clips array is explicitly provided but empty, clear faces_needed
      templateData.faces_needed = [];
      // and zero out uploads required unless we are non-ai (counts already derived from JSON)
      if (!isNonAi) {
        templateData.image_uploads_required = 0;
        templateData.video_uploads_required = 0;
        // Clear upload JSON arrays for empty clips
        templateData.image_uploads_json = [];
        templateData.video_uploads_json = [];
      }

      // Always calculate credits even for empty clips (will be 0 or 1)
      const minimumCredits = await calculateMinimumCreditsFromClips([]);
      if (templateData.credits !== undefined && templateData.credits >= minimumCredits) {
        // User provided sufficient credits, use them
      } else {
        // User provided insufficient credits or no credits, assign calculated minimum
        templateData.credits = minimumCredits || 1;
      }
    } else {
      // No clips provided in update - use resolved template type
      if (existingTemplate) {
        if (resolvedClipsAssetsType === 'ai') {
          // User specified AI or auto-detected as AI - get existing clips and calculate credits
          const existingClips = await TemplateModel.getTemplateAiClips(templateId);
          const minimumCredits = await calculateMinimumCreditsFromClips(existingClips || []);

          if (templateData.credits !== undefined && templateData.credits >= minimumCredits) {
            // User provided sufficient credits, use them
          } else {
            // User provided insufficient credits or no credits, assign calculated minimum
            templateData.credits = minimumCredits || 1;
          }
        } else {
          // User specified Non-AI or auto-detected as Non-AI
          templateData.credits = calculateNonAiTemplateCredits(templateData.template_output_type || existingTemplate.template_output_type, []);
        }
      }
    }
    // If clips is undefined, don't modify faces_needed (partial update)

    // If template type is "free", make credits zero.
    // For "premium" or "ai", the credits are already recalculated/set in the blocks above
    // (via calculateNonAiTemplateCredits or calculateMinimumCreditsFromClips).
    const effectiveTemplateType = templateData.template_type || existingTemplate.template_type;
    if (effectiveTemplateType === 'free') {
      templateData.credits = 0;
    }

    // Calculate aspect ratio, orientation, and total asset counts from bodymovin JSON for ALL templates
    const bodymovinKey = templateData.bodymovin_json_key || existingTemplate.bodymovin_json_key;
    const bodymovinBucket = templateData.bodymovin_json_bucket || existingTemplate.bodymovin_json_bucket;

    if (bodymovinKey && bodymovinBucket) {
      try {
        const storage = StorageFactory.getProvider();
        const bodymovinJson = await getBodymovinJson(storage, bodymovinBucket, bodymovinKey);
        if (bodymovinJson) {
          // Calculate aspect ratio and orientation
          if (bodymovinJson.w && bodymovinJson.h) {
            const { aspectRatio, orientation } = calculateAspectRatioAndOrientation(bodymovinJson.w, bodymovinJson.h);
            templateData.aspect_ratio = aspectRatio;
            templateData.orientation = orientation;
          }

          // Compute total asset counts for ALL templates (AI and non-AI)
          const { total_images_count, total_videos_count, total_texts_count } = computeTotalAssetCountsFromBodymovin(bodymovinJson);
          templateData.total_images_count = total_images_count;
          templateData.total_videos_count = total_videos_count;
          templateData.total_texts_count = total_texts_count;

          // Always populate upload fields from bodymovin JSON
          const { imageCount, videoCount } = computeAssetCountsFromBodymovin(bodymovinJson);
          templateData.image_uploads_required = imageCount;
          templateData.video_uploads_required = videoCount;
          templateData.image_uploads_json = generateImageUploadsJsonFromBodymovin(bodymovinJson);
          templateData.video_uploads_json = generateVideoUploadsJsonFromBodymovin(bodymovinJson);
          // const fromBodymovin = generateImageInputFieldsJsonFromBodymovin(bodymovinJson);
          // const existingFromRequest = templateData.image_input_fields_json;
          // templateData.image_input_fields_json = mergeImageInputFieldsFromRequest(fromBodymovin, existingFromRequest ?? existingTemplate.image_input_fields_json);
        }
      } catch (error) {
        logger.warn('Failed to process bodymovin JSON for template update', {
          templateId,
          error: error.message
        });
        // Set defaults if processing fails
        templateData.total_images_count = templateData.total_images_count || existingTemplate.total_images_count || 0;
        templateData.total_videos_count = templateData.total_videos_count || existingTemplate.total_videos_count || 0;
        templateData.total_texts_count = templateData.total_texts_count || existingTemplate.total_texts_count || 0;
      }
    } else {
      // No bodymovin JSON provided; keep existing values or default to zero
      templateData.total_images_count = templateData.total_images_count || existingTemplate.total_images_count || 0;
      templateData.total_videos_count = templateData.total_videos_count || existingTemplate.total_videos_count || 0;
      templateData.total_texts_count = templateData.total_texts_count || existingTemplate.total_texts_count || 0;
    }

    // Extract aspect_ratio from clips (prioritize workflow setting over Bodymovin specific logic)
    if (templateData.clips && templateData.clips.length > 0) {
      for (const clip of templateData.clips) {
        if (clip.workflow && Array.isArray(clip.workflow)) {
          for (const step of clip.workflow) {
            if (step.data && Array.isArray(step.data)) {
              const aspectRatioItem = step.data.find(d => d.type === 'aspect_ratio');
              if (aspectRatioItem && aspectRatioItem.value) {
                templateData.aspect_ratio = aspectRatioItem.value;
                break;
              }
            }
          }
        }
        if (templateData.aspect_ratio) break; // Found an aspect ratio, stop searching
      }
    }

    // Extract template_tag_ids for separate handling
    const templateTagIds = templateData.template_tag_ids;
    const nicheSlug = templateData.niche_slug; // Extract niche_slug if provided
    delete templateData.template_tag_ids;
    delete templateData.niche_slug; // Don't store niche_slug in template

    // Process custom_text_input_fields to handle new fields
    if (templateData.custom_text_input_fields && Array.isArray(templateData.custom_text_input_fields) && nicheSlug) {
      await processNewFieldsWithNicheSlug(templateData.custom_text_input_fields, nicheSlug);
    } else if (templateData.custom_text_input_fields && Array.isArray(templateData.custom_text_input_fields)) {
      // Remove new_field even if no niche_slug (to prevent storing it)
      templateData.custom_text_input_fields.forEach(field => {
        if (field.new_field) {
          delete field.new_field;
        }
      });
    }

    let updated;
    if (hasClips) {
      // Use transaction for template updates with clips
      updated = await TemplateModel.updateTemplateWithClips(templateId, templateData);
    } else {
      // Use regular update for templates without clips
      updated = await TemplateModel.updateTemplate(templateId, templateData);
    }

    // Update template tags if provided
    if (templateTagIds !== undefined) {
      await TemplateModel.updateTemplateTags(templateId, templateTagIds);
    }

    if (!updated) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template:TEMPLATE_NOT_FOUND')
      });
    }

    // Update Redis cache with fresh template data
    await TemplateRedisService.updateTemplateGenerationMeta(templateId);

    // Manual template tags are already stored above

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: {
          admin_user_id: req.user.userId,
          entity_type: 'TEMPLATES',
          action_name: 'UPDATE_TEMPLATE',
          entity_id: templateId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('template:TEMPLATE_UPDATED')
    });

  } catch (error) {
    logger.error('Error updating template:', { error: error.message, stack: error.stack });
    TemplateErrorHandler.handleTemplateErrors(error, res);
  }
}

/**
 * Helper to validate if a template is publishable based on its asset type.
 * Uses workflow_builder_version: v1 = legacy clip_workflow validation; v2 = template_ai_clips + workflows + workflow_nodes.
 */
async function validateTemplatePublishing(template, t) {
  if (!template.template_clips_assets_type) {
    return [t('template:PUBLISH_ERROR_ASSETS_TYPE_MISSING')];
  }

  const errors = [];
  if (!template.template_name) errors.push(t('template:PUBLISH_ERROR_NAME_MISSING'));
  if (!template.template_code) errors.push(t('template:PUBLISH_ERROR_CODE_MISSING'));
  if (!template.template_type) errors.push(t('template:PUBLISH_ERROR_TYPE_MISSING'));
  if (!template.template_output_type) errors.push(t('template:PUBLISH_ERROR_OUTPUT_TYPE_MISSING'));
  if (!template.color_video_key) errors.push(t('template:PUBLISH_ERROR_COLOR_VIDEO_MISSING'));
  if (!template.mask_video_key) errors.push(t('template:PUBLISH_ERROR_MASK_VIDEO_MISSING'));
  if (!template.bodymovin_json_key) errors.push(t('template:PUBLISH_ERROR_BODYMOVIN_JSON_MISSING'));

  if (template.template_clips_assets_type === 'ai') {
    const workflowBuilderVersion = (template.workflow_builder_version || 'v1').toLowerCase();

    if (workflowBuilderVersion === 'v2') {
      // V2: validate template_ai_clips + workflows table (each clip has wf_id, workflow exists, has nodes)
      const clips = await TemplateModel.getTemplateAiClips(template.template_id);
      if (!clips || clips.length === 0) {
        errors.push(t('template:PUBLISH_ERROR_AI_CLIPS_MISSING'));
      } else {
        const missingWf = clips.filter(c => c.wf_id == null);
        if (missingWf.length > 0) {
          missingWf.forEach(clip => {
            errors.push(t('template:PUBLISH_ERROR_CLIP_WORKFLOW_MISSING', { index: clip.clip_index }));
          });
        } else {
          const wfIds = clips.map(c => c.wf_id).filter(Boolean);
          const [existingWfIds, nodeCountsByWfId] = await Promise.all([
            WorkflowModel.getWorkflowIdsThatExist(wfIds),
            WorkflowModel.getWorkflowNodeCountsByWfIds(wfIds)
          ]);
          for (const clip of clips) {
            if (clip.wf_id == null) continue;
            if (!existingWfIds.has(clip.wf_id)) {
              errors.push(t('template:PUBLISH_ERROR_CLIP_WORKFLOW_MISSING', { index: clip.clip_index }));
            } else {
              const nodeCount = nodeCountsByWfId.get(clip.wf_id) || 0;
              if (nodeCount < 1) {
                errors.push(t('template:PUBLISH_ERROR_CLIP_WORKFLOW_MISSING', { index: clip.clip_index }));
              }
            }
          }
        }
      }
    } else {
      // V1: legacy validation (clip_workflow workflow array)
      const clips = await TemplateModel.getTemplateAiClips(template.template_id);
      if (!clips || clips.length === 0) {
        errors.push(t('template:PUBLISH_ERROR_AI_CLIPS_MISSING'));
      } else {
        for (const clip of clips) {
          if (!clip.workflow || clip.workflow.length === 0) {
            errors.push(t('template:PUBLISH_ERROR_CLIP_WORKFLOW_MISSING', { index: clip.clip_index }));
          }
        }
      }
    }
  }

  return errors;
}

/**
 * @api {patch} /templates/:templateId/status Update template status (publish/unpublish)
 */
exports.updateTemplateStatus = async function (req, res) {
  try {
    const { templateId } = req.params;
    const { status } = req.body;

    if (!['active', 'inactive'].includes(status)) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'Status must be either active or inactive'
      });
    }

    const template = await TemplateModel.getTemplateById(templateId);
    if (!template) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template:TEMPLATE_NOT_FOUND')
      });
    }

    if (status === 'active') {
      const errors = await validateTemplatePublishing(template, req.t);
      if (errors.length > 0) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: 'Template is not ready for publishing',
          errors: errors
        });
      }
    }

    const updated = await TemplateModel.updateTemplate(templateId, { status });
    if (!updated) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template:TEMPLATE_NOT_FOUND')
      });
    }

    // Update Redis cache
    await TemplateRedisService.updateTemplateGenerationMeta(templateId);

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('template:TEMPLATE_STATUS_UPDATED')
    });
  } catch (error) {
    logger.error('Error updating template status:', { error: error.message, stack: error.stack });
    TemplateErrorHandler.handleTemplateErrors(error, res);
  }
};

/**
 * @api {patch} /templates/status/bulk Bulk update templates status
 */
exports.bulkUpdateTemplatesStatus = async function (req, res) {
  try {
    const { template_ids, status } = req.body;

    const processTemplate = async (templateId) => {
      try {
        const template = await TemplateModel.getTemplateById(templateId);
        if (!template) {
          return { templateId, success: false, error: 'Template not found' };
        }

        if (status === 'active') {
          const errors = await validateTemplatePublishing(template, req.t);
          if (errors.length > 0) {
            return { templateId, success: false, errors: errors };
          }
        }

        const updated = await TemplateModel.updateTemplate(templateId, { status });
        if (updated) {
          await TemplateRedisService.updateTemplateGenerationMeta(templateId);
        }
        return { templateId, success: !!updated };
      } catch (err) {
        logger.error(`Error updating status for template ${templateId}`, err);
        return { templateId, success: false, error: 'Internal server error' };
      }
    };

    // Use Promise.all to process in parallel
    // Since we handle errors individually in processTemplate, Promise.all won't fail fast
    const results = await Promise.all(template_ids.map(id => processTemplate(id)));

    const allSuccess = results.every(r => r.success);
    if (allSuccess) {
      return res.status(HTTP_STATUS_CODES.OK).json({
        message: req.t('template:TEMPLATES_STATUS_BULK_UPDATED'),
        data: results
      });
    } else {
      return res.status(200).json({
        message: 'Some templates could not be updated',
        data: results,
        hasErrors: true
      });
    }
  } catch (error) {
    logger.error('Error bulk updating templates status:', { error: error.message, stack: error.stack });
    TemplateErrorHandler.handleTemplateErrors(error, res);
  }
};

/**
 * @api {post} /templates/:templateId/archive Archive template
 * @apiVersion 1.0.0
 * @apiName ArchiveTemplate
 * @apiGroup Templates
 * @apiPermission JWT
 *
 * @apiParam {String} templateId Template ID
 */
exports.archiveTemplate = async function (req, res) {
  try {
    const { templateId } = req.params;

    const archived = await TemplateModel.archiveTemplate(templateId);

    if (!archived) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template:TEMPLATE_NOT_FOUND')
      });
    }

    // Remove template from Redis cache since it's archived
    await TemplateRedisService.removeTemplateGenerationMeta(templateId);

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: {
          admin_user_id: req.user.userId,
          entity_type: 'TEMPLATES',
          action_name: 'ARCHIVE_TEMPLATE',
          entity_id: templateId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('template:TEMPLATE_ARCHIVED')
    });

  } catch (error) {
    logger.error('Error archiving template:', { error: error.message, stack: error.stack });
    TemplateErrorHandler.handleTemplateErrors(error, res);
  }
};

/**
 * @api {post} /templates/archive/bulk Bulk archive templates
 * @apiVersion 1.0.0
 * @apiName BulkArchiveTemplates
 * @apiGroup Templates
 * @apiPermission JWT
 *
 * @apiBody {String[]} template_ids Array of template IDs (min: 1, max: 50)
 */
exports.bulkArchiveTemplates = async function (req, res) {
  try {
    const { template_ids } = req.validatedBody;

    const archivedCount = await TemplateModel.bulkArchiveTemplates(template_ids);

    if (archivedCount === 0) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template:NO_TEMPLATES_ARCHIVED')
      });
    }

    // Remove archived templates from Redis cache
    await TemplateRedisService.removeMultipleTemplateGenerationMeta(template_ids);

    // Publish activity log command for each archived template
    const activityLogCommands = template_ids.map(templateId => ({
      value: {
        admin_user_id: req.user.userId,
        entity_type: 'TEMPLATES',
        action_name: 'BULK_ARCHIVE_TEMPLATE',
        entity_id: templateId
      }
    }));

    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      activityLogCommands,
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('template:TEMPLATES_BULK_ARCHIVED'),
      data: {
        archived_count: archivedCount,
        total_requested: template_ids.length
      }
    });

  } catch (error) {
    logger.error('Error bulk archiving templates:', { error: error.message, stack: error.stack });
    TemplateErrorHandler.handleTemplateErrors(error, res);
  }
};

/**
 * @api {post} /templates/unarchive/bulk Bulk unarchive templates
 * @apiVersion 1.0.0
 * @apiName BulkUnarchiveTemplates
 * @apiGroup Templates
 * @apiPermission JWT
 *
 * @apiBody {String[]} template_ids Array of template IDs (min: 1, max: 50)
 */
exports.bulkUnarchiveTemplates = async function (req, res) {
  try {
    const { template_ids } = req.validatedBody;

    const unarchivedCount = await TemplateModel.bulkUnarchiveTemplates(template_ids);

    if (unarchivedCount === 0) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template:NO_TEMPLATES_UNARCHIVED')
      });
    }

    // Update Redis cache for unarchived templates
    await Promise.all(template_ids.map(templateId =>
      TemplateRedisService.updateTemplateGenerationMeta(templateId)
    ));

    // Publish activity log command for each unarchived template
    const activityLogCommands = template_ids.map(templateId => ({
      value: {
        admin_user_id: req.user.userId,
        entity_type: 'TEMPLATES',
        action_name: 'BULK_UNARCHIVE_TEMPLATE',
        entity_id: templateId
      }
    }));

    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      activityLogCommands,
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('template:TEMPLATES_BULK_UNARCHIVED'),
      data: {
        unarchived_count: unarchivedCount,
        total_requested: template_ids.length
      }
    });

  } catch (error) {
    logger.error('Error bulk unarchiving templates:', { error: error.message, stack: error.stack });
    TemplateErrorHandler.handleTemplateErrors(error, res);
  }
};

/**
 * @api {post} /templates/:templateId/copy Copy template
 * @apiVersion 1.0.0
 * @apiName CopyTemplate
 * @apiGroup Templates
 * @apiPermission JWT
 *
 * @apiParam {String} templateId Template ID to copy
 */
exports.copyTemplate = async function (req, res) {
  try {
    const { templateId } = req.params;

    // Get the original template with all its data
    const originalTemplate = await TemplateModel.getTemplateByIdWithAssets(templateId);

    if (!originalTemplate) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template:TEMPLATE_NOT_FOUND')
      });
    }

    // Generate new template ID
    const newTemplateId = uuidv7();

    // Generate unique template code: copy first 4 letters from original + 2 random numbers
    const generateTemplateCode = (originalCode) => {
      const numbers = '0123456789';
      let newCode = '';

      // Copy first 4 characters from original template code
      newCode = originalCode.substring(0, 4);

      // Generate 2 random numbers
      for (let i = 0; i < 2; i++) {
        newCode += numbers.charAt(Math.floor(Math.random() * numbers.length));
      }

      return newCode;
    };

    // Prepare new template data
    const newTemplateData = {
      template_id: newTemplateId,
      template_name: `${originalTemplate.template_name} copy`,
      template_code: generateTemplateCode(originalTemplate.template_code),
      template_gender: originalTemplate.template_gender,
      template_output_type: originalTemplate.template_output_type,
      template_clips_assets_type: originalTemplate.template_clips_assets_type,
      description: originalTemplate.description,
      prompt: originalTemplate.prompt,
      faces_needed: originalTemplate.faces_needed,
      cf_r2_key: originalTemplate.cf_r2_key,
      cf_r2_url: originalTemplate.cf_r2_url,
      cf_r2_bucket: originalTemplate.cf_r2_bucket,
      color_video_bucket: originalTemplate.color_video_bucket,
      color_video_key: originalTemplate.color_video_key,
      mask_video_bucket: originalTemplate.mask_video_bucket,
      mask_video_key: originalTemplate.mask_video_key,
      bodymovin_json_bucket: originalTemplate.bodymovin_json_bucket,
      bodymovin_json_key: originalTemplate.bodymovin_json_key,
      custom_text_input_fields: originalTemplate.custom_text_input_fields,
      credits: originalTemplate.credits,
      image_uploads_required: originalTemplate.image_uploads_required,
      video_uploads_required: originalTemplate.video_uploads_required,
      additional_data: originalTemplate.additional_data,
      user_assets_layer: originalTemplate.user_assets_layer,
      thumb_frame_asset_key: originalTemplate.thumb_frame_asset_key,
      thumb_frame_bucket: originalTemplate.thumb_frame_bucket
    };

    // Prepare clips data for copying
    const clipsToCopy = originalTemplate.clips || [];

    // Create the new template with all related data
    await TemplateModel.createTemplate(newTemplateData, clipsToCopy);

    // Manual template tags are already stored above

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: {
          admin_user_id: req.user.userId,
          entity_type: 'TEMPLATES',
          action_name: 'COPY_TEMPLATE',
          entity_id: newTemplateId,
          original_entity_id: templateId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.CREATED).json({
      message: req.t('template:TEMPLATE_COPIED'),
      data: {
        template_id: newTemplateId,
        original_template_id: templateId
      }
    });

  } catch (error) {
    logger.error('Error copying template:', { error: error.message, stack: error.stack });
    TemplateErrorHandler.handleTemplateErrors(error, res);
  }
};

/**
 * @api {post} /templates/export Export templates
 * @apiVersion 1.0.0
 * @apiName ExportTemplates
 * @apiGroup Templates
 * @apiPermission JWT
 *
 * @apiBody {String[]} template_ids Array of template IDs to export (min: 1, max: 100)
 */
exports.exportTemplates = async function (req, res) {
  try {
    const { template_ids } = req.validatedBody;

    // Fetch templates by IDs
    const templates = await TemplateModel.getTemplatesByIdsForExport(template_ids);

    if (!templates || templates.length === 0) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template:NO_TEMPLATES_FOUND')
      });
    }

    // Transform templates to export format
    const exportData = {
      meta: {
        env: process.env.NODE_ENV || 'development',
        exported_at: new Date().toISOString(),
        total_templates: templates.length
      },
      templates: templates.map(template => transformTemplateForExport(template))
    };

    // Set response headers for file download
    const filename = `templates-export-${Date.now()}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Send as file download (not as JSON response)
    return res.send(JSON.stringify(exportData, null, 2));

  } catch (error) {
    logger.error('Error exporting templates:', { error: error.message, stack: error.stack });
    TemplateErrorHandler.handleTemplateErrors(error, res);
  }
};

/**
 * Transform template data to export format
 * Converts URL fields to asset_key/asset_bucket objects
 */
function transformTemplateForExport(template) {
  return {
    template_id: template.template_id,
    template_name: template.template_name,
    template_code: template.template_code,
    template_gender: template.template_gender,
    description: template.description,
    prompt: template.prompt,
    faces_needed: template.faces_needed,
    custom_text_input_fields: template.custom_text_input_fields,
    credits: template.credits,
    total_images_count: template.total_images_count,
    total_videos_count: template.total_videos_count,
    total_texts_count: template.total_texts_count,
    image_uploads_required: template.image_uploads_required,
    video_uploads_required: template.video_uploads_required,
    image_uploads_json: template.image_uploads_json,
    video_uploads_json: template.video_uploads_json,
    aspect_ratio: template.aspect_ratio,
    orientation: template.orientation,
    template_output_type: template.template_output_type,
    template_clips_assets_type: template.template_clips_assets_type,
    user_assets_layer: template.user_assets_layer,
    additional_data: template.additional_data,

    // Transform asset URLs to key/bucket objects
    cf_r2_asset: {
      asset_key: template.cf_r2_key || null,
      asset_bucket: template.cf_r2_bucket || null
    },
    thumb_frame_asset: {
      asset_key: template.thumb_frame_asset_key || null,
      asset_bucket: template.thumb_frame_bucket || null
    },
    color_video_asset: {
      asset_key: template.color_video_key || null,
      asset_bucket: template.color_video_bucket || null
    },
    mask_video_asset: {
      asset_key: template.mask_video_key || null,
      asset_bucket: template.mask_video_bucket || null
    },
    bodymovin_json_asset: {
      asset_key: template.bodymovin_json_key || null,
      asset_bucket: template.bodymovin_json_bucket || null
    },

    // Include clips and tags data
    clips: template.clips || [],
    tags: template.tags || [],

    created_at: template.created_at
  };
}

/**
 * @api {post} /templates/import Import templates
 * @apiVersion 1.0.0
 * @apiName ImportTemplates
 * @apiGroup Templates
 * @apiPermission JWT
 *
 * @apiBody {Object} meta Import metadata
 * @apiBody {Array} templates Array of template objects to import
 */
exports.importTemplates = async function (req, res) {
  try {
    const { templates: importTemplates, meta } = req.validatedBody;

    if (!importTemplates || importTemplates.length === 0) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'No templates to import'
      });
    }

    const storage = StorageFactory.getProvider();
    const targetBucket = config.os2.r2.bucket; // Current environment bucket
    const targetPublicBucket = config.os2.r2.public.bucket;

    // Extract source environment from meta
    const sourceEnv = meta?.env || null;

    // Process all templates in parallel
    const templateCreationPromises = importTemplates.map(async (importTemplate) => {
      try {
        // Generate new UUID for template
        const newTemplateId = uuidv7();

        // Helper function to process asset
        const processAsset = async (assetObj, assetType) => {
          if (!assetObj || !assetObj.asset_key) return null;

          const sourceBucket = assetObj.asset_bucket;
          const sourceKey = assetObj.asset_key;

          // Determine target bucket based on source
          const targetBkt = sourceBucket === 'public' ? targetPublicBucket : targetBucket;

          try {
            const result = await storage.uploadFromUrlToBucket(
              sourceKey,
              sourceBucket,
              targetBkt,
              { keyPrefix: `templates/${assetType}`, sourceEnv }
            );
            return {
              key: result.key,
              bucket: result.bucket,
              url: result.url
            };
          } catch (error) {
            logger.error(`Failed to process ${assetType} asset`, {
              templateName: importTemplate.template_name,
              error: error.message
            });

            // For cross-environment imports, log more details and guidance
            if (sourceEnv) {
              logger.warn(`Cross-environment asset import failed for ${assetType}`, {
                templateName: importTemplate.template_name,
                sourceEnv,
                sourceKey,
                sourceBucket,
                targetBucket: targetBkt,
                errorType: error.code || 'SSL_ERROR',
                guidance: 'Asset could not be imported due to SSL/access restrictions. Template created without this asset.'
              });
            }

            return null;
          }
        };

        // Process assets in batches to avoid rate limiting
        // Use smaller batch size for cross-environment imports to avoid connection issues
        const batchSize = sourceEnv ? 1 : 3;
        const assetJobs = [
          { data: importTemplate.cf_r2_asset, type: 'cf_r2' },
          { data: importTemplate.thumb_frame_asset, type: 'thumb' },
          { data: importTemplate.color_video_asset, type: 'color_video' },
          { data: importTemplate.mask_video_asset, type: 'mask_video' },
          { data: importTemplate.bodymovin_json_asset, type: 'bodymovin' }
        ];

        const results = [];
        for (let i = 0; i < assetJobs.length; i += batchSize) {
          const batch = assetJobs.slice(i, i + batchSize);
          const batchResults = await Promise.all(
            batch.map(job => processAsset(job.data, job.type))
          );
          results.push(...batchResults);

          // Add delay between batches for cross-environment imports
          if (sourceEnv && i + batchSize < assetJobs.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        const [cf_r2, thumbFrame, colorVideo, maskVideo, bodymovinJson] = results;

        // Generate unique template code based on template name
        const generateTemplateCode = (name) => {
          if (!name) return '';

          // Split into words and filter out empty strings
          const words = name.toLowerCase().split(/[\s-_]+/).filter(word => word.length > 0);
          let code = '';

          if (words.length === 0) return '';

          // If single word
          if (words.length === 1) {
            // Take first 4 letters if available, filtering non a-z
            code = words[0].replace(/[^a-z]/g, '').slice(0, 4);
          } else {
            // Take first letter of each word if it's a-z
            code = words.map(word => {
              const firstChar = word[0];
              return /[a-z]/.test(firstChar) ? firstChar : '';
            }).join('');

            // If we have less than 4 letters, add more from the last word
            if (code.length < 4) {
              const lastWord = words[words.length - 1].replace(/[^a-z]/g, '');
              code += lastWord.slice(1, 4 - code.length + 1);
            }
          }

          // Ensure code is exactly 4 characters by either truncating or taking more characters from words
          if (code.length > 4) {
            code = code.slice(0, 4);
          } else if (code.length < 4 && words.length > 0) {
            // Try to get more characters from words until we have 4
            let currentWordIndex = 0;
            while (code.length < 4 && currentWordIndex < words.length) {
              const currentWord = words[currentWordIndex].replace(/[^a-z]/g, '');
              let charIndex = code.length === 1 ? 1 : 0; // Skip first char if we already took it
              while (code.length < 4 && charIndex < currentWord.length) {
                code += currentWord[charIndex];
                charIndex++;
              }
              currentWordIndex++;
            }
          }

          // If still less than 4 chars, pad with random letters
          while (code.length < 4) {
            code += String.fromCharCode(97 + Math.floor(Math.random() * 26)); // random a-z
          }

          // Generate random number between 01-99
          const num = String(Math.floor(Math.random() * 99) + 1).padStart(2, '0');

          return (code + num).toUpperCase();
        };

        // Prepare template data
        const templateData = {
          template_id: newTemplateId,
          template_name: importTemplate.template_name,
          template_code: generateTemplateCode(importTemplate.template_name),
          template_gender: importTemplate.template_gender,
          description: importTemplate.description,
          prompt: importTemplate.prompt,
          faces_needed: importTemplate.faces_needed,
          custom_text_input_fields: importTemplate.custom_text_input_fields,
          credits: importTemplate.credits,
          total_images_count: importTemplate.total_images_count || 0,
          total_videos_count: importTemplate.total_videos_count || 0,
          total_texts_count: importTemplate.total_texts_count || 0,
          image_uploads_required: importTemplate.image_uploads_required || 0,
          video_uploads_required: importTemplate.video_uploads_required || 0,
          image_uploads_json: importTemplate.image_uploads_json,
          video_uploads_json: importTemplate.video_uploads_json,
          aspect_ratio: importTemplate.aspect_ratio,
          orientation: importTemplate.orientation,
          template_output_type: importTemplate.template_output_type,
          template_clips_assets_type: importTemplate.template_clips_assets_type,
          user_assets_layer: importTemplate.user_assets_layer,
          additional_data: importTemplate.additional_data,

          // Set asset fields from processed results
          cf_r2_key: cf_r2?.key || null,
          cf_r2_bucket: cf_r2?.bucket || null,
          cf_r2_url: cf_r2?.url || null,
          thumb_frame_asset_key: thumbFrame?.key || null,
          thumb_frame_bucket: thumbFrame?.bucket || null,
          color_video_key: colorVideo?.key || null,
          color_video_bucket: colorVideo?.bucket || null,
          mask_video_key: maskVideo?.key || null,
          mask_video_bucket: maskVideo?.bucket || null,
          bodymovin_json_key: bodymovinJson?.key || null,
          bodymovin_json_bucket: bodymovinJson?.bucket || null
        };

        // Create template with clips
        await TemplateModel.createTemplate(templateData, importTemplate.clips || []);

        // Create tags if provided
        if (importTemplate.tags && Array.isArray(importTemplate.tags) && importTemplate.tags.length > 0) {
          const TemplateTagsModel = require('../models/template.tags.model');

          logger.info('Importing tags for template', {
            templateId: newTemplateId,
            templateName: importTemplate.template_name,
            tagsCount: importTemplate.tags.length,
            tagsData: importTemplate.tags
          });

          // Check if tags have facet_id (new format) or just ttd_id (old format)
          const hasFacetId = importTemplate.tags.some(tag => tag.facet_id !== undefined);

          if (hasFacetId) {
            // New format: tags with facet_id - use importTagsToTemplate
            const validTags = importTemplate.tags.filter(tag => tag.ttd_id && tag.facet_id);
            logger.info('Using importTagsToTemplate for new format tags', {
              templateId: newTemplateId,
              validTagsCount: validTags.length
            });
            if (validTags.length > 0) {
              await TemplateTagsModel.importTagsToTemplate(newTemplateId, validTags);
            }
          } else {
            // Old format: tags with only ttd_id - use assignTagsToTemplate which will fetch facet_id
            const tagDefinitionIds = importTemplate.tags
              .filter(tag => tag.ttd_id)
              .map(tag => tag.ttd_id);
            logger.info('Using assignTagsToTemplate for old format tags', {
              templateId: newTemplateId,
              tagIdsCount: tagDefinitionIds.length,
              tagIds: tagDefinitionIds
            });
            if (tagDefinitionIds.length > 0) {
              await TemplateTagsModel.assignTagsToTemplate(newTemplateId, tagDefinitionIds);
            }
          }

          logger.info('Tags imported successfully', {
            templateId: newTemplateId,
            templateName: importTemplate.template_name
          });
        }

        // Count successful asset imports
        const assetImportSummary = {
          cf_r2: cf_r2 ? 'success' : 'failed',
          thumb_frame: thumbFrame ? 'success' : 'failed',
          color_video: colorVideo ? 'success' : 'failed',
          mask_video: maskVideo ? 'success' : 'failed',
          bodymovin_json: bodymovinJson ? 'success' : 'failed'
        };

        const successfulAssets = Object.values(assetImportSummary).filter(s => s === 'success').length;
        const failedAssets = Object.values(assetImportSummary).filter(s => s === 'failed').length;

        return {
          status: 'success',
          template_id: newTemplateId,
          original_name: importTemplate.template_name,
          assets: assetImportSummary,
          assets_summary: {
            successful: successfulAssets,
            failed: failedAssets,
            total: 5
          }
        };
      } catch (error) {
        logger.error('Failed to import template', {
          templateName: importTemplate.template_name,
          error: error.message,
          stack: error.stack
        });
        return {
          status: 'failed',
          original_name: importTemplate.template_name,
          error: error.message
        };
      }
    });

    // Wait for all templates to be created
    const results = await Promise.all(templateCreationPromises);

    // Check if there were asset import failures
    const templatesWithAssetFailures = results.filter(r =>
      r.status === 'success' && r.assets_summary && r.assets_summary.failed > 0
    );

    const summary = {
      total: results.length,
      successful: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failed').length,
      ...(templatesWithAssetFailures.length > 0 && {
        templates_with_asset_failures: templatesWithAssetFailures.length,
        asset_import_note: sourceEnv
          ? `Cross-environment import from '${sourceEnv}' encountered SSL/access issues. Templates created without some assets.`
          : 'Some assets could not be imported.'
      })
    };

    // Publish activity log commands for successful imports
    const successfulImports = results.filter(r => r.status === 'success');
    if (successfulImports.length > 0) {
      const activityLogCommands = successfulImports.map(result => ({
        value: {
          admin_user_id: req.user.userId,
          entity_type: 'TEMPLATES',
          action_name: 'IMPORT_TEMPLATE',
          entity_id: result.template_id
        }
      }));

      await kafkaCtrl.sendMessage(
        TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
        activityLogCommands,
        'create_admin_activity_log'
      );
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: `Import completed: ${summary.successful}/${summary.total} templates created`,
      data: {
        summary,
        results
      }
    });

  } catch (error) {
    logger.error('Error importing templates:', { error: error.message, stack: error.stack });
    TemplateErrorHandler.handleTemplateErrors(error, res);
  }
}; 
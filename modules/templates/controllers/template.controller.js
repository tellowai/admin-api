'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const TemplateModel = require('../models/template.model');
const TemplateErrorHandler = require('../middlewares/template.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const StorageFactory = require('../../os2/providers/storage.factory');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const TEMPLATE_CONSTANTS = require('../constants/template.constants');
const { v4: uuidv4 } = require('uuid');
const config = require('../../../config/config');
const fetch = require('node-fetch');
const AiModelModel = require('../../ai-models/models/ai-model.model');

// Timeout for fetching Bodymovin JSON (in milliseconds)
const BODYMOVIN_FETCH_TIMEOUT_MS = 10000;

/**
 * Fetch helper with timeout using AbortController
 * Aborts the request after timeoutMs and lets caller handle the error
 */
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
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
exports.listTemplates = async function(req, res) {
  try {
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const templates = await TemplateModel.listTemplates(paginationParams);

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
 * @api {get} /templates/archived List archived templates
 * @apiVersion 1.0.0
 * @apiName ListArchivedTemplates
 * @apiGroup Templates
 * @apiPermission JWT
 *
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.listArchivedTemplates = async function(req, res) {
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
exports.searchTemplates = async function(req, res) {
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
exports.createTemplate = async function(req, res) {
  try {
    const templateData = req.validatedBody;
    // Generate UUID for template_id
    templateData.template_id = uuidv4();

    // Auto-detect AI vs Non-AI based on actual clips content
    const hasAiModels = templateData.clips && templateData.clips.length > 0 ? hasAiModelsInClips(templateData.clips) : false;
    const resolvedClipsAssetsType = hasAiModels ? 'ai' : 'non-ai';
    
    // Override user's template_clips_assets_type with auto-detected value
    templateData.template_clips_assets_type = resolvedClipsAssetsType;

    if (resolvedClipsAssetsType === 'non-ai') {
      // Force non-ai templates to have no clips and derive counts from Bodymovin JSON
      templateData.clips = [];
      templateData.faces_needed = [];
      // Calculate credits for non-AI templates based on output type and clips
      templateData.credits = calculateNonAiTemplateCredits(templateData.template_output_type, templateData.clips);

      try {
        const key = templateData.bodymovin_json_key;
        const bucket = templateData.bodymovin_json_bucket;

        if (key && bucket) {
          const storage = StorageFactory.getProvider();
          let downloadUrl;
          if (/^https?:\/\//i.test(key)) {
            downloadUrl = key;
          } else {
            const isPublic = bucket === 'public' || bucket === storage.publicBucket || bucket === (config.os2?.r2?.public?.bucket);
            downloadUrl = isPublic ? `${config.os2.r2.public.bucketUrl}/${key}` : await storage.generatePresignedDownloadUrl(key);
          }

          const response = await fetchWithTimeout(downloadUrl, BODYMOVIN_FETCH_TIMEOUT_MS);
          if (response.ok) {
            const bodymovinJson = await response.json();
            const { imageCount, videoCount } = computeAssetCountsFromBodymovin(bodymovinJson);
            templateData.image_uploads_required = imageCount;
            templateData.video_uploads_required = videoCount;
          } else {
            templateData.image_uploads_required = 0;
            templateData.video_uploads_required = 0;
          }
        } else {
          templateData.image_uploads_required = 0;
          templateData.video_uploads_required = 0;
        }
      } catch (_err) {
        templateData.image_uploads_required = 0;
        templateData.video_uploads_required = 0;
      }
    } else {
      // AI templates: derive from clips
      if (templateData.clips && templateData.clips.length > 0) {
        templateData.faces_needed = generateFacesNeededFromClips(templateData.clips);
        templateData.image_uploads_required = calculateImageUploadsRequiredFromClips(templateData.clips);
        templateData.video_uploads_required = calculateVideoUploadsRequiredFromClips(templateData.clips);
        
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

    // Extract clips data for transaction
    const clips = templateData.clips;
    delete templateData.clips;

    await TemplateModel.createTemplate(templateData, clips);
    
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
 * Generate faces_needed array from clips data
 * @param {Array} clips - Array of clip objects with workflows
 * @returns {Array} Array of unique faces needed
 */
function generateFacesNeededFromClips(clips) {
  if (!clips || !Array.isArray(clips) || clips.length === 0) {
    return [];
  }

  // Collect genders from any workflow step data items with type 'character_gender' (or legacy 'gender')
  const gendersSet = new Set();

  clips.forEach((clip, clipIndex) => {
    if (!clip || !Array.isArray(clip.workflow)) return;

    clip.workflow.forEach((workflowStep, stepIndex) => {
      if (!workflowStep || !Array.isArray(workflowStep.data)) return;

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
    const id = uuidv4();
    return {
      ...face,
      template_character_id: id,
      character_id: id
    };
  });

  logger.info('Generated faces_needed from clips', {
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
  console.log(clientProvidedCredits, minimumCredits,'clientProvidedCredits, minimumCredits')
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
exports.updateTemplate = async function(req, res) {
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

    // Auto-detect AI vs Non-AI based on actual clips content
    const hasAiModels = templateData.clips && templateData.clips.length > 0 ? hasAiModelsInClips(templateData.clips) : false;
    const resolvedClipsAssetsType = hasAiModels ? 'ai' : 'non-ai';
    const isNonAi = resolvedClipsAssetsType === 'non-ai';
    
    // Override user's template_clips_assets_type with auto-detected value
    templateData.template_clips_assets_type = resolvedClipsAssetsType;
    
    logger.info('UpdateTemplate auto-detected template_clips_assets_type', { templateId, resolvedClipsAssetsType, hasAiModels });

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

      // Derive image/video upload counts from Bodymovin JSON if available
      try {
        const key = templateData.bodymovin_json_key || existingTemplate.bodymovin_json_key;
        const bucket = templateData.bodymovin_json_bucket || existingTemplate.bodymovin_json_bucket;

        if (key && bucket) {
          const storage = StorageFactory.getProvider();
          let downloadUrl;
          // If key already looks like a URL, use it as-is
          if (/^https?:\/\//i.test(key)) {
            downloadUrl = key;
          } else {
            // Treat string literal 'public' as the public bucket selector
            const isPublic = bucket === 'public' || bucket === storage.publicBucket || bucket === (config.os2?.r2?.public?.bucket);
            if (isPublic) {
              downloadUrl = `${config.os2.r2.public.bucketUrl}/${key}`;
            } else {
              // Fallback: presign from the default private bucket
              downloadUrl = await storage.generatePresignedDownloadUrl(key);
            }
          }

          logger.info('Fetching Bodymovin JSON for non-ai template', { templateId, bucket, key, downloadUrl });
          const response = await fetchWithTimeout(downloadUrl, BODYMOVIN_FETCH_TIMEOUT_MS);
          if (response.ok) {
            const bodymovinJson = await response.json();
            const { imageCount, videoCount } = computeAssetCountsFromBodymovin(bodymovinJson);
            templateData.image_uploads_required = imageCount;
            templateData.video_uploads_required = videoCount;
            logger.info('Computed asset counts from Bodymovin', { templateId, imageCount, videoCount });
          } else {
            logger.warn('Failed to fetch Bodymovin JSON for non-ai template update', { templateId, key, status: response.status });
            // Fallback to zero if cannot fetch
            templateData.image_uploads_required = 0;
            templateData.video_uploads_required = 0;
          }
        } else {
          // No JSON provided; default to zero
          templateData.image_uploads_required = 0;
          templateData.video_uploads_required = 0;
        }
      } catch (jsonError) {
        logger.warn('Error deriving counts from Bodymovin JSON for non-ai template update', { templateId, error: jsonError.message });
        templateData.image_uploads_required = 0;
        templateData.video_uploads_required = 0;
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
      logger.info('CreditsCalc: update flow derived minimum', { minimumCredits });
      
      if (templateData.credits !== undefined && templateData.credits >= minimumCredits) {
        // User provided sufficient credits, use them
        logger.info('CreditsCalc: using provided credits (update)', { provided: templateData.credits, minimumCredits });
      } else {
        // User provided insufficient credits or no credits, always assign calculated minimum
        templateData.credits = minimumCredits || 1;
        logger.info('CreditsCalc: assigned calculated minimum credits (update)', { 
          provided: templateData.credits, 
          assigned: templateData.credits,
          minimumCredits 
        });
      }
    } else if (templateData.clips !== undefined) {
      // If clips array is explicitly provided but empty, clear faces_needed
      templateData.faces_needed = [];
      // and zero out uploads required unless we are non-ai (counts already derived from JSON)
      if (!isNonAi) {
        templateData.image_uploads_required = 0;
        templateData.video_uploads_required = 0;
      }
      
      // Always calculate credits even for empty clips (will be 0 or 1)
      const minimumCredits = await calculateMinimumCreditsFromClips([]);
      if (templateData.credits !== undefined && templateData.credits >= minimumCredits) {
        // User provided sufficient credits, use them
        logger.info('CreditsCalc: using provided credits for empty clips (update)', { provided: templateData.credits, minimumCredits });
      } else {
        // User provided insufficient credits or no credits, assign calculated minimum
        templateData.credits = minimumCredits || 1;
        logger.info('CreditsCalc: assigned calculated minimum credits for empty clips (update)', { 
          provided: templateData.credits, 
          assigned: templateData.credits,
          minimumCredits 
        });
      }
    } else {
      // No clips provided in update - check existing clips and auto-detect AI vs Non-AI
      if (existingTemplate) {
        // Get existing clips from database to check for AI models
        const existingClips = await TemplateModel.getTemplateAiClips(templateId);
        const hasExistingAiModels = hasAiModelsInClips(existingClips || []);
        
        if (hasExistingAiModels) {
          // Existing clips have AI models - treat as AI template
          const minimumCredits = await calculateMinimumCreditsFromClips(existingClips || []);
          
          if (templateData.credits !== undefined && templateData.credits >= minimumCredits) {
            // User provided sufficient credits, use them
            logger.info('CreditsCalc: using provided credits for existing AI clips (update)', { provided: templateData.credits, minimumCredits });
          } else {
            // User provided insufficient credits or no credits, assign calculated minimum
            templateData.credits = minimumCredits || 1;
            logger.info('CreditsCalc: assigned calculated minimum credits for existing AI clips (update)', { 
              provided: templateData.credits, 
              assigned: templateData.credits,
              minimumCredits 
            });
          }
        } else {
          // Existing clips have no AI models - treat as Non-AI template
          templateData.template_clips_assets_type = 'non-ai';
          templateData.credits = calculateNonAiTemplateCredits(templateData.template_output_type || existingTemplate.template_output_type, []);
          logger.info('CreditsCalc: treated as Non-AI based on existing clips (update)', { 
            provided: templateData.credits, 
            assigned: templateData.credits
          });
        }
      }
    }
    // If clips is undefined, don't modify faces_needed (partial update)

    logger.info('Final uploads required before persist', {
      templateId,
      image_uploads_required: templateData.image_uploads_required,
      video_uploads_required: templateData.video_uploads_required,
      hasClips
    });
    let updated;
    if (hasClips) {
      // Use transaction for template updates with clips
      updated = await TemplateModel.updateTemplateWithClips(templateId, templateData);
    } else {
      // Use regular update for templates without clips
      updated = await TemplateModel.updateTemplate(templateId, templateData);
    }
    
    if (!updated) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template:TEMPLATE_NOT_FOUND')
      });
    }

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
exports.archiveTemplate = async function(req, res) {
  try {
    const { templateId } = req.params;
    
    const archived = await TemplateModel.archiveTemplate(templateId);
    
    if (!archived) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template:TEMPLATE_NOT_FOUND')
      });
    }

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
exports.bulkArchiveTemplates = async function(req, res) {
  try {
    const { template_ids } = req.validatedBody;
    
    const archivedCount = await TemplateModel.bulkArchiveTemplates(template_ids);
    
    if (archivedCount === 0) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template:NO_TEMPLATES_ARCHIVED')
      });
    }

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
exports.bulkUnarchiveTemplates = async function(req, res) {
  try {
    const { template_ids } = req.validatedBody;
    
    const unarchivedCount = await TemplateModel.bulkUnarchiveTemplates(template_ids);
    
    if (unarchivedCount === 0) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('template:NO_TEMPLATES_UNARCHIVED')
      });
    }

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
exports.copyTemplate = async function(req, res) {
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
    const newTemplateId = uuidv4();
    
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
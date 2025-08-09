'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const TemplateModel = require('../models/template.model');
const TemplateErrorHandler = require('../middlewares/template.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const StorageFactory = require('../../os2/providers/storage.factory');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const { v4: uuidv4 } = require('uuid');
const config = require('../../../config/config');


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

    // Generate faces_needed from clips data for all template types
    if (templateData.clips && templateData.clips.length > 0) {
      templateData.faces_needed = generateFacesNeededFromClips(templateData.clips);
      // Compute number of user image uploads required from workflow payload
      templateData.image_uploads_required = calculateImageUploadsRequiredFromClips(templateData.clips);
      // Auto-derive template_gender if not provided
      if (!templateData.template_gender) {
        if (templateData.faces_needed && templateData.faces_needed.length === 2) {
          templateData.template_gender = 'couple';
        } else if (templateData.faces_needed && templateData.faces_needed.length === 1) {
          templateData.template_gender = templateData.faces_needed[0].character_gender;
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

  logger.info('Generated faces_needed from clips', {
    totalClips: clips.length,
    genders: Array.from(gendersSet),
    facesNeeded
  });

  return facesNeeded;
}

/**
 * Calculate how many user image uploads are required based on workflow steps
 * Counts occurrences of a step asking the user to upload an image
 * Recognizes by workflow_code 'ask_user_to_upload_image' or workflow_id 'user-upload-image'
 * @param {Array} clips
 * @returns {number}
 */
function calculateImageUploadsRequiredFromClips(clips) {
  if (!Array.isArray(clips)) return 0;

  let uploads = 0;
  for (const clip of clips) {
    if (!clip || !Array.isArray(clip.workflow)) continue;
    for (const step of clip.workflow) {
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

    // Handle faces_needed for all template types
    const hasClips = templateData.clips && templateData.clips.length > 0;
    
    if (hasClips) {
      // Generate faces_needed from clips data when clips are provided
      templateData.faces_needed = generateFacesNeededFromClips(templateData.clips);
      // Recompute uploads required when clips are provided
      templateData.image_uploads_required = calculateImageUploadsRequiredFromClips(templateData.clips);

      console.log(templateData.faces_needed,'templateData.faces_needed')
      // Auto-derive template_gender if not explicitly provided in update
      if (templateData.template_gender === undefined) {
        if (templateData.faces_needed && templateData.faces_needed.length === 2) {
          templateData.template_gender = 'couple';
        } else if (templateData.faces_needed && templateData.faces_needed.length === 1) {
          templateData.template_gender = templateData.faces_needed[0].character_gender;
        }
      }
    } else if (templateData.clips !== undefined) {
      // If clips array is explicitly provided but empty, clear faces_needed
      templateData.faces_needed = [];
      // and zero out uploads required
      templateData.image_uploads_required = 0;
    }
    // If clips is undefined, don't modify faces_needed (partial update)

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
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
      
      // Get video template IDs for batch fetching AE assets
      const videoTemplateIds = templates
        .filter(template => template.template_output_type === 'video')
        .map(template => template.template_id);

      // Batch fetch AE assets for all video templates
      let aeAssetsMap = {};
      if (videoTemplateIds.length > 0) {
        const aeAssetsList = await TemplateModel.getTemplateAeAssetsBatch(videoTemplateIds);
        aeAssetsMap = aeAssetsList.reduce((map, aeAsset) => {
          map[aeAsset.template_id] = aeAsset;
          return map;
        }, {});
      }
      
      await Promise.all(templates.map(async (template) => {
        if (template.cf_r2_key) {
          template.r2_url = `${config.os2.r2.public.bucketUrl}/${template.cf_r2_key}`;
        } else {
          template.r2_url = template.cf_r2_url;
        }
        

        // Parse JSON fields if they are strings and load video clips for video templates
        if (template.template_output_type === 'video') {
          // Load video clips for video templates
          template.clips = await TemplateModel.getTemplateVideoClips(template.template_id);
          
          // Generate R2 URLs for video clip assets
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

          // Add AE assets data for video templates
          const aeAssets = aeAssetsMap[template.template_id];
          if (aeAssets) {
            template.ae_assets = {
              taae_id: aeAssets.taae_id,
              color_video_bucket: aeAssets.color_video_bucket,
              color_video_key: aeAssets.color_video_key,
              mask_video_bucket: aeAssets.mask_video_bucket,
              mask_video_key: aeAssets.mask_video_key,
              bodymovin_json_bucket: aeAssets.bodymovin_json_bucket,
              bodymovin_json_key: aeAssets.bodymovin_json_key,
              created_at: aeAssets.created_at,
              updated_at: aeAssets.updated_at
            };

            // Generate R2 URLs for AE assets
            if (aeAssets.color_video_key && aeAssets.color_video_bucket) {
              template.ae_assets.color_video_r2_url = `${config.os2.r2.public.bucketUrl}/${aeAssets.color_video_key}`;
            }
            if (aeAssets.mask_video_key && aeAssets.mask_video_bucket) {
              template.ae_assets.mask_video_r2_url = `${config.os2.r2.public.bucketUrl}/${aeAssets.mask_video_key}`;
            }
            if (aeAssets.bodymovin_json_key && aeAssets.bodymovin_json_bucket) {
              template.ae_assets.bodymovin_json_r2_url = `${config.os2.r2.public.bucketUrl}/${aeAssets.bodymovin_json_key}`;
            }
          }
        } else if (template.faces_needed && typeof template.faces_needed === 'string') {
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
        
        if (template.sounds && typeof template.sounds === 'string') {
          try {
            template.sounds = JSON.parse(template.sounds);
          } catch (err) {
            logger.error('Error parsing sounds:', {
              error: err.message,
              value: template.sounds
            });
          }
        }
        
        // Generate R2 URLs for sound assets
        if (template.sounds && Array.isArray(template.sounds)) {
          template.sounds = await Promise.all(template.sounds.map(async (sound) => {
            if (sound.asset_key && sound.asset_bucket) {
              if (sound.asset_bucket === 'public') {
                // For public bucket, use direct URL
                sound.r2_url = `${config.os2.r2.public.bucketUrl}/${sound.asset_key}`;
              } else {
                // For private bucket, generate presigned URL
                try {
                  sound.r2_url = await storage.generatePresignedDownloadUrl(sound.asset_key, { expiresIn: 3600 });
                } catch (err) {
                  logger.error('Error generating presigned URL for sound:', {
                    error: err.message,
                    asset_key: sound.asset_key
                  });
                }
              }
            }
            return sound;
          }));
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
      
      // Get video template IDs for batch fetching AE assets
      const videoTemplateIds = templates
        .filter(template => template.template_output_type === 'video')
        .map(template => template.template_id);

      // Batch fetch AE assets for all video templates
      let aeAssetsMap = {};
      if (videoTemplateIds.length > 0) {
        const aeAssetsList = await TemplateModel.getTemplateAeAssetsBatch(videoTemplateIds);
        aeAssetsMap = aeAssetsList.reduce((map, aeAsset) => {
          map[aeAsset.template_id] = aeAsset;
          return map;
        }, {});
      }
      
      await Promise.all(templates.map(async (template) => {
        if (template.cf_r2_key) {
          template.r2_url = `${config.os2.r2.public.bucketUrl}/${template.cf_r2_key}`;
        } else {
          template.r2_url = template.cf_r2_url;
        }
        
        // Parse JSON fields if they are strings and load video clips for video templates
        if (template.template_output_type === 'video') {
          // Load video clips for video templates
          template.clips = await TemplateModel.getTemplateVideoClips(template.template_id);
          
          // Generate R2 URLs for video clip assets
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

          // Add AE assets data for video templates
          const aeAssets = aeAssetsMap[template.template_id];
          if (aeAssets) {
            template.ae_assets = {
              taae_id: aeAssets.taae_id,
              color_video_bucket: aeAssets.color_video_bucket,
              color_video_key: aeAssets.color_video_key,
              mask_video_bucket: aeAssets.mask_video_bucket,
              mask_video_key: aeAssets.mask_video_key,
              bodymovin_json_bucket: aeAssets.bodymovin_json_bucket,
              bodymovin_json_key: aeAssets.bodymovin_json_key,
              created_at: aeAssets.created_at,
              updated_at: aeAssets.updated_at
            };

            // Generate R2 URLs for AE assets
            if (aeAssets.color_video_key && aeAssets.color_video_bucket) {
              template.ae_assets.color_video_r2_url = `${config.os2.r2.public.bucketUrl}/${aeAssets.color_video_key}`;
            }
            if (aeAssets.mask_video_key && aeAssets.mask_video_bucket) {
              template.ae_assets.mask_video_r2_url = `${config.os2.r2.public.bucketUrl}/${aeAssets.mask_video_key}`;
            }
            if (aeAssets.bodymovin_json_key && aeAssets.bodymovin_json_bucket) {
              template.ae_assets.bodymovin_json_r2_url = `${config.os2.r2.public.bucketUrl}/${aeAssets.bodymovin_json_key}`;
            }
          }
        } else if (template.faces_needed && typeof template.faces_needed === 'string') {
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
        
        if (template.sounds && typeof template.sounds === 'string') {
          try {
            template.sounds = JSON.parse(template.sounds);
          } catch (err) {
            logger.error('Error parsing sounds:', {
              error: err.message,
              value: template.sounds
            });
          }
        }
        
        // Generate R2 URLs for sound assets
        if (template.sounds && Array.isArray(template.sounds)) {
          template.sounds = await Promise.all(template.sounds.map(async (sound) => {
            if (sound.asset_key && sound.asset_bucket) {
              if (sound.asset_bucket === 'public') {
                // For public bucket, use direct URL
                sound.r2_url = `${config.os2.r2.public.bucketUrl}/${sound.asset_key}`;
              } else {
                // For private bucket, generate presigned URL
                try {
                  sound.r2_url = await storage.generatePresignedDownloadUrl(sound.asset_key, { expiresIn: 3600 });
                } catch (err) {
                  logger.error('Error generating presigned URL for sound:', {
                    error: err.message,
                    asset_key: sound.asset_key
                  });
                }
              }
            }
            return sound;
          }));
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
 * @apiBody {String} [template_gender] Template gender (male, female, unisex, couple)
 * @apiBody {String} description Template description
 * @apiBody {String} [prompt] Template prompt (required for image templates)
 * @apiBody {Object} [faces_needed] Required faces configuration (only for image templates)
 * @apiBody {String} [cf_r2_key] Cloudflare R2 key
 * @apiBody {String} [cf_r2_url] Cloudflare R2 URL
 * @apiBody {Number} [credits=1] Credits required
 * @apiBody {Object} [additional_data] Additional template data
 * @apiBody {Array} [clips] Video clips array (required for video templates)
 * @apiBody {Array} [sounds] Audio tracks array (for video templates)
 */
exports.createTemplate = async function(req, res) {
  try {
    const templateData = req.validatedBody;
    // Generate UUID for template_id
    templateData.template_id = uuidv4();

    // Generate faces_needed from clips data for video templates
    if (templateData.template_output_type === 'video' && templateData.clips && templateData.clips.length > 0) {
      templateData.faces_needed = generateFacesNeededFromClips(templateData.clips);
    }

    // Extract AE asset data for video templates
    let aeAssetData = null;
    if (templateData.template_output_type === 'video') {
      const aeFields = ['color_video_bucket', 'color_video_key', 'mask_video_bucket', 'mask_video_key', 'bodymovin_json_bucket', 'bodymovin_json_key'];
      aeAssetData = {};
      let hasAeData = false;
      
      aeFields.forEach(field => {
        if (templateData[field] !== undefined) {
          aeAssetData[field] = templateData[field];
          delete templateData[field]; // Remove from main template data
          hasAeData = true;
        }
      });
      
      if (hasAeData) {
        aeAssetData.template_id = templateData.template_id;
        aeAssetData.taae_id = uuidv4();
      } else {
        aeAssetData = null;
      }
    }

    await TemplateModel.createTemplate(templateData, aeAssetData);
    
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
 * @param {Array} clips - Array of clip objects
 * @returns {Array} Array of unique faces needed
 */
function generateFacesNeededFromClips(clips) {
  if (!clips || !Array.isArray(clips) || clips.length === 0) {
    return [];
  }

  const facesMap = new Map();
  let characterCounter = 1;
  
  // Process characters based on template type
  clips.forEach((clip, clipIndex) => {
    if (clip.video_type === 'ai' && clip.characters && Array.isArray(clip.characters)) {
      clip.characters.forEach((character, charIndex) => {
        if (character.character && 
            character.character.character_name && 
            character.character.character_gender) {
          
          const gender = character.character.character_gender.toLowerCase().trim();
          
          // Skip if gender is invalid
          if (!gender || !['male', 'female'].includes(gender)) {
            logger.warn('Skipping character with invalid gender:', {
              clipIndex,
              charIndex,
              gender,
              reason: !gender ? 'empty gender' : 'invalid gender'
            });
            return;
          }

          // Create a unique key based on gender
          const key = gender;
          
          // Add to map if not already present
          if (!facesMap.has(key)) {
            facesMap.set(key, {
              character_name: `Character ${characterCounter}`,
              character_gender: gender
            });
            characterCounter++;
          }
        }
      });
    }
  });
  
  // Convert Map to Array and sort by gender
  const facesArray = Array.from(facesMap.values());
  facesArray.sort((a, b) => a.character_gender.localeCompare(b.character_gender));
  
  logger.info('Generated faces_needed:', {
    totalClips: clips.length,
    aiClips: clips.filter(c => c.video_type === 'ai').length,
    uniqueFaces: facesArray.length,
    faces: facesArray,
    maleCount: facesArray.filter(f => f.character_gender === 'male').length,
    femaleCount: facesArray.filter(f => f.character_gender === 'female').length
  });
  
  return facesArray;
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
 * @apiBody {String} [template_gender] Template gender (male, female, unisex, couple)
 * @apiBody {String} [description] Template description
 * @apiBody {String} [prompt] Template prompt
 * @apiBody {Object} [faces_needed] Required faces configuration (only for image templates)
 * @apiBody {String} [cf_r2_key] Cloudflare R2 key
 * @apiBody {String} [cf_r2_url] Cloudflare R2 URL
 * @apiBody {Number} [credits] Credits required
 * @apiBody {Object} [additional_data] Additional template data
 * @apiBody {Array} [clips] Video clips array (for video templates)
 * @apiBody {Array} [sounds] Audio tracks array (for video templates)
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

    // Determine if this is a video template with clips
    const isVideoTemplate = (templateData.template_output_type === 'video') || 
                           (existingTemplate.template_output_type === 'video' && !templateData.template_output_type);
    const hasClips = templateData.clips && templateData.clips.length > 0;

    // Handle faces_needed for video templates
    if (isVideoTemplate) {
      if (hasClips) {
        // Generate faces_needed from clips data when clips are provided
        templateData.faces_needed = generateFacesNeededFromClips(templateData.clips);
      } else if (templateData.clips !== undefined) {
        // If clips array is explicitly provided but empty, clear faces_needed
        templateData.faces_needed = [];
      }
      // If clips is undefined, don't modify faces_needed (partial update)
    } else if (templateData.template_output_type && templateData.template_output_type !== 'video') {
      // If changing from video to non-video template, clear faces_needed
      templateData.faces_needed = null;
    }

    // Extract AE asset data for video templates
    let aeAssetData = null;
    if (isVideoTemplate) {
      const aeFields = ['color_video_bucket', 'color_video_key', 'mask_video_bucket', 'mask_video_key', 'bodymovin_json_bucket', 'bodymovin_json_key'];
      aeAssetData = {};
      let hasAeData = false;
      
      aeFields.forEach(field => {
        if (templateData[field] !== undefined) {
          aeAssetData[field] = templateData[field];
          delete templateData[field]; // Remove from main template data
          hasAeData = true;
        }
      });
      
      if (hasAeData) {
        aeAssetData.template_id = templateId;
        aeAssetData.taae_id = uuidv4();
      } else {
        aeAssetData = null;
      }
    }

    let updated;
    if (isVideoTemplate && (hasClips || aeAssetData)) {
      // Use transaction for video template updates with clips or AE assets
      updated = await TemplateModel.updateTemplateWithClips(templateId, templateData, aeAssetData);
    } else {
      // Use regular update for non-video templates or video templates without clips/AE assets
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
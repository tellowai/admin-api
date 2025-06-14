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
        if (template.cf_r2_key) {
          template.r2_url = `${config.os2.r2.public.bucketUrl}/${template.cf_r2_key}`;
        } else {
          template.r2_url = template.cf_r2_url;
        }
        

        // Parse JSON fields if they are strings and load video clips for video templates
        if (template.template_output_type === 'video') {
          // Load video clips for video templates
          template.clips = await TemplateModel.getTemplateVideoClips(template.template_id);
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
        if (template.cf_r2_key) {
          template.r2_url = `${config.os2.r2.public.bucketUrl}/${template.cf_r2_key}`;
        } else {
          template.r2_url = template.cf_r2_url;
        }
        
        // Parse JSON fields if they are strings and load video clips for video templates
        if (template.template_output_type === 'video') {
          // Load video clips for video templates
          template.clips = await TemplateModel.getTemplateVideoClips(template.template_id);
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
 */
exports.createTemplate = async function(req, res) {
  try {
    const templateData = req.validatedBody;
    // Generate UUID for template_id
    templateData.template_id = uuidv4();

    await TemplateModel.createTemplate(templateData);
    
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

    let updated;
    if (isVideoTemplate && hasClips) {
      // Use transaction for video template updates with clips
      updated = await TemplateModel.updateTemplateWithClips(templateId, templateData);
    } else {
      // Use regular update for non-video templates or video templates without clips
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
'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const CuratedOnboardingTemplateModel = require('../models/curated.onboarding.template.model');
const CuratedOnboardingTemplateErrorHandler = require('../middlewares/curated.onboarding.template.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const config = require('../../../config/config');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');

class CuratedOnboardingTemplateController {
  static async listCuratedOnboardingTemplates(req, res) {
    try {
      const paginationParams = PaginationCtrl.getPaginationParams(req.query);
      const filters = {
        is_active: req.query.is_active !== undefined ? parseInt(req.query.is_active) : undefined,
        template_output_type: req.query.template_output_type || undefined
      };
      
      // Get curated onboarding templates
      const curatedTemplates = await CuratedOnboardingTemplateModel.listCuratedOnboardingTemplates(
        paginationParams,
        filters
      );
      
      if (curatedTemplates.length === 0) {
        return res.status(HTTP_STATUS_CODES.OK).json({
          data: []
        });
      }
      
      // Get template IDs
      const templateIds = curatedTemplates.map(ct => ct.template_id);
      
      // Get template details
      const templates = await CuratedOnboardingTemplateModel.getTemplatesByIds(templateIds);
      
      // Create a map of template_id to template data
      const templateMap = new Map();
      templates.forEach(template => {
        templateMap.set(template.template_id, template);
      });
      
      // Stitch data together
      const result = curatedTemplates.map(curatedTemplate => {
        const template = templateMap.get(curatedTemplate.template_id);
        
        // Apply template_output_type filter if specified
        if (filters.template_output_type && template && template.template_output_type !== filters.template_output_type) {
          return null;
        }
        
        // Generate R2 URL for template thumbnail (same logic as templates controller)
        let r2_url = null;
        if (template) {
          if (template.cf_r2_key) {
            r2_url = `${config.os2.r2.public.bucketUrl}/${template.cf_r2_key}`;
          } else {
            r2_url = template.cf_r2_url;
          }
        }
        
        return {
          cot_id: curatedTemplate.cot_id,
          template_id: curatedTemplate.template_id,
          is_active: curatedTemplate.is_active,
          created_at: curatedTemplate.created_at,
          updated_at: curatedTemplate.updated_at,
          template_name: template?.template_name || null,
          template_code: template?.template_code || null,
          template_gender: template?.template_gender || null,
          template_output_type: template?.template_output_type || null,
          r2_url: r2_url,
          cf_r2_url: template?.cf_r2_url || null,
          credits: template?.credits || null
        };
      }).filter(item => item !== null); // Remove items that don't match template_output_type filter
      
      return res.status(HTTP_STATUS_CODES.OK).json({
        data: result
      });
    } catch (error) {
      logger.error('Error listing curated onboarding templates:', { 
        error: error.message, 
        stack: error.stack 
      });
      CuratedOnboardingTemplateErrorHandler.handleCuratedOnboardingTemplateErrors(error, res);
    }
  }

  static async createCuratedOnboardingTemplate(req, res) {
    try {
      const templateData = req.validatedBody;
      
      // Check if template_id already exists
      const existing = await CuratedOnboardingTemplateModel.getCuratedOnboardingTemplateByTemplateId(
        templateData.template_id
      );
      
      if (existing) {
        return res.status(HTTP_STATUS_CODES.CONFLICT).json({
          message: 'Template already exists in curated onboarding templates'
        });
      }
      
      const cotId = await CuratedOnboardingTemplateModel.createCuratedOnboardingTemplate(templateData);
      
      // Publish activity log command
      await kafkaCtrl.sendMessage(
        TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
        [{
          value: { 
            admin_user_id: req.user.userId,
            entity_type: 'CURATED_ONBOARDING_TEMPLATES',
            action_name: 'ADD_NEW_CURATED_ONBOARDING_TEMPLATE', 
            entity_id: cotId.toString()
          }
        }],
        'create_admin_activity_log'
      );
    
      return res.status(HTTP_STATUS_CODES.CREATED).json({
        message: 'Curated onboarding template created successfully',
        data: { cot_id: cotId }
      });
    } catch (error) {
      logger.error('Error creating curated onboarding template:', { 
        error: error.message, 
        stack: error.stack 
      });
      CuratedOnboardingTemplateErrorHandler.handleCuratedOnboardingTemplateErrors(error, res);
    }
  }

  static async getCuratedOnboardingTemplate(req, res) {
    try {
      const { cotId } = req.params;
      const template = await CuratedOnboardingTemplateModel.getCuratedOnboardingTemplate(cotId);
      
      if (!template) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: 'Curated onboarding template not found'
        });
      }

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: template
      });
    } catch (error) {
      logger.error('Error getting curated onboarding template:', { 
        error: error.message, 
        stack: error.stack 
      });
      CuratedOnboardingTemplateErrorHandler.handleCuratedOnboardingTemplateErrors(error, res);
    }
  }

  static async updateCuratedOnboardingTemplate(req, res) {
    try {
      const { cotId } = req.params;
      const updateData = req.validatedBody;
      
      // Check if template exists
      const existing = await CuratedOnboardingTemplateModel.getCuratedOnboardingTemplate(cotId);
      if (!existing) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: 'Curated onboarding template not found'
        });
      }
      
      // If updating template_id, check for duplicates
      if (updateData.template_id && updateData.template_id !== existing.template_id) {
        const duplicate = await CuratedOnboardingTemplateModel.getCuratedOnboardingTemplateByTemplateId(
          updateData.template_id
        );
        if (duplicate) {
          return res.status(HTTP_STATUS_CODES.CONFLICT).json({
            message: 'Template ID already exists in curated onboarding templates'
          });
        }
      }
      
      const updated = await CuratedOnboardingTemplateModel.updateCuratedOnboardingTemplate(
        cotId,
        updateData
      );
      
      if (!updated) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: 'Failed to update curated onboarding template'
        });
      }
      
      // Publish activity log command
      await kafkaCtrl.sendMessage(
        TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
        [{
          value: { 
            admin_user_id: req.user.userId,
            entity_type: 'CURATED_ONBOARDING_TEMPLATES',
            action_name: 'UPDATE_CURATED_ONBOARDING_TEMPLATE', 
            entity_id: cotId.toString()
          }
        }],
        'create_admin_activity_log'
      );
      
      return res.status(HTTP_STATUS_CODES.OK).json({
        message: 'Curated onboarding template updated successfully'
      });
    } catch (error) {
      logger.error('Error updating curated onboarding template:', { 
        error: error.message, 
        stack: error.stack 
      });
      CuratedOnboardingTemplateErrorHandler.handleCuratedOnboardingTemplateErrors(error, res);
    }
  }

  static async archiveCuratedOnboardingTemplate(req, res) {
    try {
      const { cotId } = req.params;
      
      const archived = await CuratedOnboardingTemplateModel.archiveCuratedOnboardingTemplate(cotId);
      
      if (!archived) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: 'Curated onboarding template not found'
        });
      }
      
      // Publish activity log command
      await kafkaCtrl.sendMessage(
        TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
        [{
          value: { 
            admin_user_id: req.user.userId,
            entity_type: 'CURATED_ONBOARDING_TEMPLATES',
            action_name: 'ARCHIVE_CURATED_ONBOARDING_TEMPLATE', 
            entity_id: cotId.toString()
          }
        }],
        'create_admin_activity_log'
      );
      
      return res.status(HTTP_STATUS_CODES.OK).json({
        message: 'Curated onboarding template archived successfully'
      });
    } catch (error) {
      logger.error('Error archiving curated onboarding template:', { 
        error: error.message, 
        stack: error.stack 
      });
      CuratedOnboardingTemplateErrorHandler.handleCuratedOnboardingTemplateErrors(error, res);
    }
  }

  static async bulkCreateCuratedOnboardingTemplates(req, res) {
    try {
      const { template_ids, is_active } = req.validatedBody;
      
      if (!template_ids || template_ids.length === 0) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: 'template_ids array is required and cannot be empty'
        });
      }
      
      const result = await CuratedOnboardingTemplateModel.bulkCreateCuratedOnboardingTemplates(
        template_ids,
        is_active !== undefined ? is_active : 1
      );
      
      // Publish activity log command
      await kafkaCtrl.sendMessage(
        TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
        [{
          value: { 
            admin_user_id: req.user.userId,
            entity_type: 'CURATED_ONBOARDING_TEMPLATES',
            action_name: 'BULK_ADD_CURATED_ONBOARDING_TEMPLATES', 
            entity_id: template_ids.join(',')
          }
        }],
        'create_admin_activity_log'
      );
    
      return res.status(HTTP_STATUS_CODES.CREATED).json({
        message: 'Curated onboarding templates created successfully',
        data: {
          inserted: result.inserted || 0,
          skipped: result.skipped || 0,
          unarchived: result.unarchived || 0,
          existing_template_ids: result.existingIds || []
        }
      });
    } catch (error) {
      logger.error('Error bulk creating curated onboarding templates:', { 
        error: error.message, 
        stack: error.stack 
      });
      CuratedOnboardingTemplateErrorHandler.handleCuratedOnboardingTemplateErrors(error, res);
    }
  }

  static async bulkArchiveCuratedOnboardingTemplates(req, res) {
    try {
      const { cot_ids } = req.validatedBody;
      
      if (!cot_ids || cot_ids.length === 0) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: 'cot_ids array is required and cannot be empty'
        });
      }
      
      const archivedCount = await CuratedOnboardingTemplateModel.bulkArchiveCuratedOnboardingTemplates(cot_ids);
      
      // Publish activity log command
      await kafkaCtrl.sendMessage(
        TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
        [{
          value: { 
            admin_user_id: req.user.userId,
            entity_type: 'CURATED_ONBOARDING_TEMPLATES',
            action_name: 'BULK_ARCHIVE_CURATED_ONBOARDING_TEMPLATES', 
            entity_id: cot_ids.join(',')
          }
        }],
        'create_admin_activity_log'
      );
      
      return res.status(HTTP_STATUS_CODES.OK).json({
        message: 'Curated onboarding templates archived successfully',
        data: {
          archived_count: archivedCount
        }
      });
    } catch (error) {
      logger.error('Error bulk archiving curated onboarding templates:', { 
        error: error.message, 
        stack: error.stack 
      });
      CuratedOnboardingTemplateErrorHandler.handleCuratedOnboardingTemplateErrors(error, res);
    }
  }

  static async bulkArchiveByTemplateIds(req, res) {
    try {
      const { template_ids } = req.validatedBody;
      
      if (!template_ids || template_ids.length === 0) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: 'template_ids array is required and cannot be empty'
        });
      }
      
      const archivedCount = await CuratedOnboardingTemplateModel.bulkArchiveByTemplateIds(template_ids);
      
      // Publish activity log command
      await kafkaCtrl.sendMessage(
        TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
        [{
          value: { 
            admin_user_id: req.user.userId,
            entity_type: 'CURATED_ONBOARDING_TEMPLATES',
            action_name: 'BULK_ARCHIVE_CURATED_ONBOARDING_TEMPLATES_BY_TEMPLATE_IDS', 
            entity_id: template_ids.join(',')
          }
        }],
        'create_admin_activity_log'
      );
      
      return res.status(HTTP_STATUS_CODES.OK).json({
        message: 'Curated onboarding templates archived successfully',
        data: {
          archived_count: archivedCount
        }
      });
    } catch (error) {
      logger.error('Error bulk archiving curated onboarding templates by template IDs:', { 
        error: error.message, 
        stack: error.stack 
      });
      CuratedOnboardingTemplateErrorHandler.handleCuratedOnboardingTemplateErrors(error, res);
    }
  }

  static async bulkUpdateCuratedOnboardingTemplates(req, res) {
    try {
      const { cot_ids, is_active } = req.validatedBody;
      
      if (!cot_ids || cot_ids.length === 0) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: 'cot_ids array is required and cannot be empty'
        });
      }
      
      const updatedCount = await CuratedOnboardingTemplateModel.bulkUpdateCuratedOnboardingTemplates(
        cot_ids,
        is_active
      );
      
      // Publish activity log command
      await kafkaCtrl.sendMessage(
        TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
        [{
          value: { 
            admin_user_id: req.user.userId,
            entity_type: 'CURATED_ONBOARDING_TEMPLATES',
            action_name: 'BULK_UPDATE_CURATED_ONBOARDING_TEMPLATES', 
            entity_id: cot_ids.join(',')
          }
        }],
        'create_admin_activity_log'
      );
      
      return res.status(HTTP_STATUS_CODES.OK).json({
        message: `Curated onboarding templates ${is_active === 1 ? 'activated' : 'deactivated'} successfully`,
        data: {
          updated_count: updatedCount
        }
      });
    } catch (error) {
      logger.error('Error bulk updating curated onboarding templates:', { 
        error: error.message, 
        stack: error.stack 
      });
      CuratedOnboardingTemplateErrorHandler.handleCuratedOnboardingTemplateErrors(error, res);
    }
  }
}

module.exports = CuratedOnboardingTemplateController;


'use strict';

const i18next = require('i18next');
const PackModel = require('../models/pack.model');
const PACK_CONSTANTS = require('../constants/pack.constants');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const PackErrorHandler = require('../middlewares/pack.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const config = require('../../../config/config');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const { publishNewAdminActivityLog } = require('../../core/controllers/activitylog.controller');

class PackController {
  static async listPacks(req, res) {
    try {
      const paginationParams = PaginationCtrl.getPaginationParams(req.query);
      const packs = await PackModel.listPacks(paginationParams.limit, paginationParams.offset);
      
      // Generate R2 URLs if packs exist
      if (packs.length) {
        packs.forEach(pack => {
          if (pack.thumbnail_cf_r2_key) {
            pack.r2_url = `${config.os2.r2.public.bucketUrl}/${pack.thumbnail_cf_r2_key}`;
          } else {
            pack.r2_url = pack.thumbnail_cf_r2_url;
          }

          // Parse JSON fields if they are strings
          if (pack.additional_data && typeof pack.additional_data === 'string') {
            try {
              pack.additional_data = JSON.parse(pack.additional_data);
            } catch (err) {
              logger.error('Error parsing additional_data:', {
                error: err.message,
                value: pack.additional_data
              });
            }
          }
        });
      }

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: packs
      });
    } catch (error) {
      logger.error('Error listing packs:', { error: error.message, stack: error.stack });
      PackErrorHandler.handlePackErrors(error, res);
    }
  }

  static async createPack(req, res) {
    try {
      const packData = req.validatedBody;
      console.log(packData,'packData')
      const packId = await PackModel.createPack(packData);

      // Publish activity log command
      const activityLogObj = {
        adminUserId: req.user && req.user.userId ? req.user.userId : null,
        entityType: 'PACKS',
        actionName: 'ADD_NEW_PACK',
        entityId: packId,
        additionalData: {}
      };
      await publishNewAdminActivityLog(activityLogObj);
    
      return res.status(HTTP_STATUS_CODES.CREATED).json({
        message: req.t('packs:success.pack_created'),
        data: { pack_id: packId }
      });
    } catch (error) {
      logger.error('Error creating pack:', { error: error.message, stack: error.stack });
      PackErrorHandler.handlePackErrors(error, res);
    }
  }

  static async getPack(req, res) {
    try {
      const { packId } = req.params;
      const pack = await PackModel.getPack(packId);
      
      if (!pack) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: req.t('packs:errors.pack_not_found')
        });
      }

      // Generate R2 URL if pack has thumbnail
      if (pack.thumbnail_cf_r2_key) {
        pack.r2_url = `${config.os2.r2.public.bucketUrl}/${pack.thumbnail_cf_r2_key}`;
      } else {
        pack.r2_url = pack.thumbnail_cf_r2_url;
      }

      // Parse JSON fields if they are strings
      if (pack.additional_data && typeof pack.additional_data === 'string') {
        try {
          pack.additional_data = JSON.parse(pack.additional_data);
        } catch (err) {
          logger.error('Error parsing additional_data:', {
            error: err.message,
            value: pack.additional_data
          });
        }
      }

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: pack
      });
    } catch (error) {
      logger.error('Error getting pack:', { error: error.message, stack: error.stack });
      PackErrorHandler.handlePackErrors(error, res);
    }
  }

  static async updatePack(req, res) {
    try {
      const { packId } = req.params;
      const packData = req.validatedBody;
      
      const pack = await PackModel.getPack(packId);
      if (!pack) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: req.t('packs:errors.pack_not_found')
        });
      }

      const updated = await PackModel.updatePack(packId, packData);
      if (!updated) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: req.t('packs:errors.pack_not_found')
        });
      }

      // Publish activity log command
      await kafkaCtrl.sendMessage(
        TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
        [{
          value: { 
            admin_user_id: req.user.userId,
            entity_type: 'PACKS',
            action_name: 'UPDATE_PACK', 
            entity_id: packId
          }
        }],
        'create_admin_activity_log'
      );

      return res.status(HTTP_STATUS_CODES.OK).json({
        message: req.t('packs:success.pack_updated')
      });
    } catch (error) {
      logger.error('Error updating pack:', { error: error.message, stack: error.stack });
      PackErrorHandler.handlePackErrors(error, res);
    }
  }

  static async archivePack(req, res) {
    try {
      const { packId } = req.params;
      
      const pack = await PackModel.getPack(packId);
      if (!pack) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: req.t('packs:errors.pack_not_found')
        });
      }

      if (pack.user_id !== req.user.userId) {
        return res.status(HTTP_STATUS_CODES.FORBIDDEN).json({
          message: req.t('common:errors.forbidden')
        });
      }

      const archived = await PackModel.archivePack(packId);
      if (!archived) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: req.t('packs:errors.pack_not_found')
        });
      }

      // Publish activity log command
      await kafkaCtrl.sendMessage(
        TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
        [{
          value: { 
            admin_user_id: req.user.userId,
            entity_type: 'PACKS',
            action_name: 'ARCHIVE_PACK', 
            entity_id: packId
          }
        }],
        'create_admin_activity_log'
      );

      return res.status(HTTP_STATUS_CODES.OK).json({
        message: req.t('packs:success.pack_archived')
      });
    } catch (error) {
      logger.error('Error archiving pack:', { error: error.message, stack: error.stack });
      PackErrorHandler.handlePackErrors(error, res);
    }
  }

  static async getPackTemplates(req, res) {
    try {
      const { packId } = req.params;
      
      const pack = await PackModel.getPack(packId);
      if (!pack) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: req.t('packs:errors.pack_not_found')
        });
      }

      // Get pack templates
      const packTemplates = await PackModel.getPackTemplates(packId);
      
      if (!packTemplates.length) {
        return res.status(HTTP_STATUS_CODES.OK).json({
          data: []
        });
      }

      // Get template details
      const templateIds = packTemplates.map(pt => pt.template_id);
      const templates = await PackModel.getTemplatesByIds(templateIds);

      // Create a map of template details for quick lookup
      const templateMap = new Map(templates.map(t => [t.template_id, t]));

      // Combine pack templates with template details
      const combinedTemplates = packTemplates.map(pt => {
        const template = templateMap.get(pt.template_id);
        if (!template) return null;

        // Process template data
        const processedTemplate = {
          ...template,
          pack_template_id: pt.pack_template_id,
          sort_order: pt.sort_order
        };

        // Generate R2 URL
        if (processedTemplate.cf_r2_key) {
          processedTemplate.r2_url = `${config.os2.r2.public.bucketUrl}/${processedTemplate.cf_r2_key}`;
        } else {
          processedTemplate.r2_url = processedTemplate.cf_r2_url;
        }

        // Parse JSON fields if they are strings
        if (processedTemplate.additional_data && typeof processedTemplate.additional_data === 'string') {
          try {
            processedTemplate.additional_data = JSON.parse(processedTemplate.additional_data);
          } catch (err) {
            logger.error('Error parsing additional_data:', {
              error: err.message,
              value: processedTemplate.additional_data
            });
          }
        }

        return processedTemplate;
      }).filter(Boolean); // Remove any null values from missing templates

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: combinedTemplates
      });
    } catch (error) {
      logger.error('Error getting pack templates:', { error: error.message, stack: error.stack });
      PackErrorHandler.handlePackErrors(error, res);
    }
  }

  static async addTemplates(req, res) {
    try {
      const { packId } = req.params;
      const { templates } = req.validatedBody;
      
      const pack = await PackModel.getPack(packId);
      if (!pack) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: req.t('packs:errors.pack_not_found')
        });
      }

      // Check template limit
      const currentTemplateCount = await PackModel.countPackTemplates(packId);
      if (currentTemplateCount + templates.length > PACK_CONSTANTS.MAX_TEMPLATES_PER_PACK) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: req.t('packs:errors.templates_limit_exceeded', { 
            current: currentTemplateCount,
            adding: templates.length,
            max: PACK_CONSTANTS.MAX_TEMPLATES_PER_PACK 
          })
        });
      }

      // Check if templates exist and get their details
      const templateIds = templates.map(t => t.template_id);
      const existingTemplates = await PackModel.getTemplatesByIds(templateIds);
      const existingTemplateIds = existingTemplates.map(t => t.template_id);
      const nonExistingTemplateIds = templateIds.filter(id => !existingTemplateIds.includes(id));

      if (nonExistingTemplateIds.length > 0) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: req.t('packs:errors.template_not_found'),
          data: { non_existing_templates: nonExistingTemplateIds }
        });
      }

      // Add templates
      for (const template of templates) {
        await PackModel.addTemplateToPackWithOrder(packId, template.template_id, template.sort_order);
      }

      // Process template details
      const processedTemplates = existingTemplates.map(template => {
        const templateData = {
          ...template,
          sort_order: templates.find(t => t.template_id === template.template_id).sort_order
        };

        // Generate R2 URL
        if (templateData.cf_r2_key) {
          templateData.r2_url = `${config.os2.r2.public.bucketUrl}/${templateData.cf_r2_key}`;
        } else {
          templateData.r2_url = templateData.cf_r2_url;
        }

        // Parse JSON fields if they are strings
        if (templateData.additional_data && typeof templateData.additional_data === 'string') {
          try {
            templateData.additional_data = JSON.parse(templateData.additional_data);
          } catch (err) {
            logger.error('Error parsing additional_data:', {
              error: err.message,
              value: templateData.additional_data
            });
          }
        }

        return templateData;
      });

      // Publish activity log command
      await kafkaCtrl.sendMessage(
        TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
        [{
          value: { 
            entity_type: 'PACKS',
            action_name: 'ADD_TEMPLATES_TO_PACK', 
            entity_id: packId
          }
        }],
        'create_admin_activity_log'
      );

      return res.status(HTTP_STATUS_CODES.OK).json({
        message: req.t('packs:success.templates_added'),
        data: {
          added_templates: processedTemplates
        }
      });
    } catch (error) {
      logger.error('Error adding templates to pack:', { error: error.message, stack: error.stack });
      PackErrorHandler.handlePackErrors(error, res);
    }
  }

  static async removeTemplates(req, res) {
    try {
      const { packId } = req.params;
      const { template_ids } = req.validatedBody;
      
      const pack = await PackModel.getPack(packId);
      if (!pack) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: req.t('packs:errors.pack_not_found')
        });
      }

      // Check which templates are in the pack
      const packTemplates = await PackModel.getPackTemplates(packId);
      const packTemplateIds = packTemplates.map(t => t.template_id);
      const templatesNotInPack = template_ids.filter(id => !packTemplateIds.includes(id));
      const templatesToRemove = template_ids.filter(id => packTemplateIds.includes(id));

      // Remove templates
      for (const templateId of templatesToRemove) {
        await PackModel.removeTemplateFromPack(packId, templateId);
      }

      // Publish activity log command
      await kafkaCtrl.sendMessage(
        TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
        [{
          value: { 
            admin_user_id: req.user.userId,
            entity_type: 'PACKS',
            action_name: 'REMOVE_TEMPLATES_FROM_PACK', 
            entity_id: packId
          }
        }],
        'create_admin_activity_log'
      );

      return res.status(HTTP_STATUS_CODES.OK).json({
        message: req.t('packs:success.templates_removed'),
        data: {
          removed_templates: templatesToRemove,
          templates_not_in_pack: templatesNotInPack
        }
      });
    } catch (error) {
      logger.error('Error removing templates from pack:', { error: error.message, stack: error.stack });
      PackErrorHandler.handlePackErrors(error, res);
    }
  }
}

module.exports = PackController; 
'use strict';

const i18next = require('i18next');
const PackModel = require('../models/pack.model');
const PACK_CONSTANTS = require('../constants/pack.constants');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const PackErrorHandler = require('../middlewares/pack.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const config = require('../../../config/config');
const { publishNewAdminActivityLog } = require('../../core/controllers/activitylog.controller');
const { recomputePackPricing } = require('../utils/packPricing.util');

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

      await publishNewAdminActivityLog({
        adminUserId: req.user && req.user.userId ? req.user.userId : null,
        entityType: 'PACKS',
        actionName: 'UPDATE_PACK',
        entityId: packId,
        additionalData: JSON.stringify({})
      });

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

      await publishNewAdminActivityLog({
        adminUserId: req.user && req.user.userId ? req.user.userId : null,
        entityType: 'PACKS',
        actionName: 'ARCHIVE_PACK',
        entityId: packId,
        additionalData: JSON.stringify({})
      });

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

      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const rawLimit = parseInt(req.query.limit, 10) || 20;
      const limit = Math.min(100, Math.max(1, rawLimit));
      const offset = (page - 1) * limit;
      const q = req.query.q != null ? String(req.query.q).trim() : '';

      const pack = await PackModel.getPack(packId);
      if (!pack) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: req.t('packs:errors.pack_not_found')
        });
      }

      let total;
      let packTemplates;

      if (!q) {
        total = await PackModel.countPackTemplates(packId);
        packTemplates = await PackModel.getPackTemplatesPaginated(packId, limit, offset);
      } else {
        const [allLinks, matchRows] = await Promise.all([
          PackModel.getPackTemplates(packId),
          PackModel.listTemplateIdsMatchingNameOrCode(q),
        ]);
        const matchSet = new Set(matchRows.map((r) => r.template_id));
        const filtered = allLinks.filter((l) => matchSet.has(l.template_id));
        total = filtered.length;
        packTemplates = filtered.slice(offset, offset + limit);
      }

      if (!packTemplates.length) {
        return res.status(HTTP_STATUS_CODES.OK).json({
          data: [],
          meta: { total, page, limit, has_more: false },
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
        data: combinedTemplates,
        meta: {
          total,
          page,
          limit,
          has_more: offset + combinedTemplates.length < total,
        },
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

      await recomputePackPricing(packId);

      const packAfter = await PackModel.getPack(packId);

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

      await publishNewAdminActivityLog({
        adminUserId: req.user && req.user.userId ? req.user.userId : null,
        entityType: 'PACKS',
        actionName: 'ADD_TEMPLATES_TO_PACK',
        entityId: packId,
        additionalData: JSON.stringify({
          template_ids: templateIds,
          added_count: templateIds.length,
          credits: packAfter ? packAfter.credits : null,
          alacarte_price: packAfter ? packAfter.alacarte_price : null,
          alacarte_original_price: packAfter ? packAfter.alacarte_original_price : null,
          language_code: packAfter ? packAfter.language_code : null
        })
      });

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

      const remainingAfterRemove = packTemplateIds.length - templatesToRemove.length;
      if (remainingAfterRemove < PACK_CONSTANTS.MIN_TEMPLATES_PER_PACK) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: req.t('packs:errors.templates_minimum_not_met', {
            min: PACK_CONSTANTS.MIN_TEMPLATES_PER_PACK,
            remaining: remainingAfterRemove
          })
        });
      }

      // Remove templates
      for (const templateId of templatesToRemove) {
        await PackModel.removeTemplateFromPack(packId, templateId);
      }

      await recomputePackPricing(packId);

      const packAfter = await PackModel.getPack(packId);

      await publishNewAdminActivityLog({
        adminUserId: req.user && req.user.userId ? req.user.userId : null,
        entityType: 'PACKS',
        actionName: 'REMOVE_TEMPLATES_FROM_PACK',
        entityId: packId,
        additionalData: JSON.stringify({
          template_ids: templatesToRemove,
          removed_count: templatesToRemove.length,
          credits: packAfter ? packAfter.credits : null,
          alacarte_price: packAfter ? packAfter.alacarte_price : null,
          alacarte_original_price: packAfter ? packAfter.alacarte_original_price : null,
          language_code: packAfter ? packAfter.language_code : null
        })
      });

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
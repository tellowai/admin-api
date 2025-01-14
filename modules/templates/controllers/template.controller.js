'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const TemplateModel = require('../models/template.model');
const TemplateErrorHandler = require('../middlewares/template.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const StorageFactory = require('../../os2/providers/storage.factory');

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
          template.r2_url = await storage.generatePresignedDownloadUrl(template.cf_r2_key);
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
          template.r2_url = await storage.generatePresignedDownloadUrl(template.cf_r2_key);
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
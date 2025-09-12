'use strict';

const i18next = require('i18next');
const LeadModel = require('../models/lead.model');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const LeadErrorHandler = require('../middlewares/lead.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');

class LeadController {
  static async listLeads(req, res) {
    try {
      const paginationParams = PaginationCtrl.getPaginationParams(req.query);
      const leads = await LeadModel.listLeads(paginationParams.limit, paginationParams.offset);
      
      return res.status(HTTP_STATUS_CODES.OK).json({
        data: leads
      });
    } catch (error) {
      logger.error('Error listing leads:', { error: error.message, stack: error.stack });
      LeadErrorHandler.handleLeadErrors(error, res);
    }
  }

  static async getLead(req, res) {
    try {
      const { leadId } = req.params;
      const lead = await LeadModel.getLead(leadId);
      
      if (!lead) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
          message: req.t('leads:errors.lead_not_found')
        });
      }

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: lead
      });
    } catch (error) {
      logger.error('Error getting lead:', { error: error.message, stack: error.stack });
      LeadErrorHandler.handleLeadErrors(error, res);
    }
  }
}

module.exports = LeadController;

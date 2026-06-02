'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const logger = require('../../../config/lib/logger');
const AnalyticsErrorHandler = require('../../analytics/middlewares/analytics.error.handler');
const InfraCostUnitEconomicsService = require('../services/infra-cost-unit-economics.service');
const TimezoneService = require('../../analytics/services/timezone.service');

class InfraCostAnalyticsController {
  /**
   * GET /analytics/infra-cost/unit-economics
   * Daily + monthly unit economics (multi-cloud infra vs users).
   */
  static async getUnitEconomics(req, res) {
    try {
      const q = req.validatedQuery;
      const payload = {
        start_date: TimezoneService.toCalendarYmdFromHttpParam(req.query.start_date),
        end_date: TimezoneService.toCalendarYmdFromHttpParam(req.query.end_date),
        tz: TimezoneService.normalizeTimezoneAlias(q.tz || 'UTC')
      };
      const data = await InfraCostUnitEconomicsService.getUnitEconomicsOverview(payload);
      return res.status(HTTP_STATUS_CODES.OK).json({ data: data || { daily_series: [], monthly_series: [] } });
    } catch (error) {
      logger.error('Error fetching infra cost unit economics:', {
        error: error.message,
        query: req.validatedQuery
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }
}

module.exports = InfraCostAnalyticsController;

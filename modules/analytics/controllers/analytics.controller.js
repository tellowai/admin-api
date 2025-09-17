'use strict';

const i18next = require('i18next');
const AnalyticsService = require('../services/analytics.service');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const AnalyticsErrorHandler = require('../middlewares/analytics.error.handler');
const logger = require('../../../config/lib/logger');

class AnalyticsController {
  static async getCharacterCreations(req, res) {
    try {
      const queryParams = req.validatedQuery;
      
      const filters = {
        start_date: queryParams.start_date,
        end_date: queryParams.end_date,
        start_time: queryParams.start_time,
        end_time: queryParams.end_time
      };

      const additionalFilters = {};
      if (queryParams.gender) additionalFilters.gender = queryParams.gender;
      if (queryParams.character_id) additionalFilters.character_id = queryParams.character_id;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      const characterCreations = await AnalyticsService.queryMixedDateRange('CHARACTER_CREATIONS', filters, additionalFilters);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: characterCreations
      });
    } catch (error) {
      logger.error('Error fetching character creations analytics:', { 
        error: error.message, 
        stack: error.stack,
        query: req.validatedQuery 
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getCharacterTrainings(req, res) {
    try {
      const queryParams = req.validatedQuery;
      
      const filters = {
        start_date: queryParams.start_date,
        end_date: queryParams.end_date,
        start_time: queryParams.start_time,
        end_time: queryParams.end_time
      };

      const additionalFilters = {};
      if (queryParams.gender) additionalFilters.gender = queryParams.gender;
      if (queryParams.character_id) additionalFilters.character_id = queryParams.character_id;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      const characterTrainings = await AnalyticsService.queryMixedDateRange('CHARACTER_TRAININGS', filters, additionalFilters);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: characterTrainings
      });
    } catch (error) {
      logger.error('Error fetching character trainings analytics:', { 
        error: error.message, 
        stack: error.stack,
        query: req.validatedQuery 
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getTemplateViews(req, res) {
    try {
      const queryParams = req.validatedQuery;
      
      const filters = {
        start_date: queryParams.start_date,
        end_date: queryParams.end_date,
        start_time: queryParams.start_time,
        end_time: queryParams.end_time
      };

      const additionalFilters = {};
      if (queryParams.output_type) additionalFilters.output_type = queryParams.output_type;
      if (queryParams.aspect_ratio) additionalFilters.aspect_ratio = queryParams.aspect_ratio;
      if (queryParams.orientation) additionalFilters.orientation = queryParams.orientation;
      if (queryParams.generation_type) additionalFilters.generation_type = queryParams.generation_type;
      if (queryParams.template_id) additionalFilters.template_id = queryParams.template_id;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      const templateViews = await AnalyticsService.queryMixedDateRange('TEMPLATE_VIEWS', filters, additionalFilters);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: templateViews
      });
    } catch (error) {
      logger.error('Error fetching template views analytics:', { 
        error: error.message, 
        stack: error.stack,
        query: req.validatedQuery 
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getTemplateTries(req, res) {
    try {
      const queryParams = req.validatedQuery;
      
      const filters = {
        start_date: queryParams.start_date,
        end_date: queryParams.end_date,
        start_time: queryParams.start_time,
        end_time: queryParams.end_time
      };

      const additionalFilters = {};
      if (queryParams.output_type) additionalFilters.output_type = queryParams.output_type;
      if (queryParams.aspect_ratio) additionalFilters.aspect_ratio = queryParams.aspect_ratio;
      if (queryParams.orientation) additionalFilters.orientation = queryParams.orientation;
      if (queryParams.generation_type) additionalFilters.generation_type = queryParams.generation_type;
      if (queryParams.template_id) additionalFilters.template_id = queryParams.template_id;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      const templateTries = await AnalyticsService.queryMixedDateRange('TEMPLATE_TRIES', filters, additionalFilters);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: templateTries
      });
    } catch (error) {
      logger.error('Error fetching template tries analytics:', { 
        error: error.message, 
        stack: error.stack,
        query: req.validatedQuery 
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getTemplateDownloads(req, res) {
    try {
      const queryParams = req.validatedQuery;
      
      const filters = {
        start_date: queryParams.start_date,
        end_date: queryParams.end_date,
        start_time: queryParams.start_time,
        end_time: queryParams.end_time
      };

      const additionalFilters = {};
      if (queryParams.output_type) additionalFilters.output_type = queryParams.output_type;
      if (queryParams.aspect_ratio) additionalFilters.aspect_ratio = queryParams.aspect_ratio;
      if (queryParams.orientation) additionalFilters.orientation = queryParams.orientation;
      if (queryParams.generation_type) additionalFilters.generation_type = queryParams.generation_type;
      if (queryParams.template_id) additionalFilters.template_id = queryParams.template_id;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      const templateDownloads = await AnalyticsService.queryMixedDateRange('TEMPLATE_DOWNLOADS', filters, additionalFilters);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: templateDownloads
      });
    } catch (error) {
      logger.error('Error fetching template downloads analytics:', { 
        error: error.message, 
        stack: error.stack,
        query: req.validatedQuery 
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getCharacterAnalyticsSummary(req, res) {
    try {
      const queryParams = req.validatedQuery;
      
      const filters = {
        start_date: queryParams.start_date,
        end_date: queryParams.end_date,
        start_time: queryParams.start_time,
        end_time: queryParams.end_time
      };

      const additionalFilters = {};
      if (queryParams.gender) additionalFilters.gender = queryParams.gender;
      if (queryParams.character_id) additionalFilters.character_id = queryParams.character_id;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      const [totalCreations, totalTrainings] = await Promise.all([
        AnalyticsService.getCountMixedDateRange('CHARACTER_CREATIONS', filters, additionalFilters),
        AnalyticsService.getCountMixedDateRange('CHARACTER_TRAININGS', filters, additionalFilters)
      ]);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: {
          character_creations: {
            total_count: totalCreations
          },
          character_trainings: {
            total_count: totalTrainings
          },
          date_range: {
            start_date: queryParams.start_date,
            end_date: queryParams.end_date
          }
        }
      });
    } catch (error) {
      logger.error('Error fetching character analytics summary:', { 
        error: error.message, 
        stack: error.stack,
        query: req.validatedQuery 
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getTemplateAnalyticsSummary(req, res) {
    try {
      const queryParams = req.validatedQuery;
      
      const filters = {
        start_date: queryParams.start_date,
        end_date: queryParams.end_date,
        start_time: queryParams.start_time,
        end_time: queryParams.end_time
      };

      const additionalFilters = {};
      if (queryParams.output_type) additionalFilters.output_type = queryParams.output_type;
      if (queryParams.aspect_ratio) additionalFilters.aspect_ratio = queryParams.aspect_ratio;
      if (queryParams.orientation) additionalFilters.orientation = queryParams.orientation;
      if (queryParams.generation_type) additionalFilters.generation_type = queryParams.generation_type;
      if (queryParams.template_id) additionalFilters.template_id = queryParams.template_id;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      const [totalViews, totalTries] = await Promise.all([
        AnalyticsService.getCountMixedDateRange('TEMPLATE_VIEWS', filters, additionalFilters),
        AnalyticsService.getCountMixedDateRange('TEMPLATE_TRIES', filters, additionalFilters)
      ]);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: {
          template_views: {
            total_count: totalViews
          },
          template_tries: {
            total_count: totalTries
          },
          date_range: {
            start_date: queryParams.start_date,
            end_date: queryParams.end_date
          }
        }
      });
    } catch (error) {
      logger.error('Error fetching template analytics summary:', { 
        error: error.message, 
        stack: error.stack,
        query: req.validatedQuery 
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getTemplateDownloadsSummary(req, res) {
    try {
      const queryParams = req.validatedQuery;
      
      const filters = {
        start_date: queryParams.start_date,
        end_date: queryParams.end_date,
        start_time: queryParams.start_time,
        end_time: queryParams.end_time
      };

      const additionalFilters = {};
      if (queryParams.output_type) additionalFilters.output_type = queryParams.output_type;
      if (queryParams.aspect_ratio) additionalFilters.aspect_ratio = queryParams.aspect_ratio;
      if (queryParams.orientation) additionalFilters.orientation = queryParams.orientation;
      if (queryParams.generation_type) additionalFilters.generation_type = queryParams.generation_type;
      if (queryParams.template_id) additionalFilters.template_id = queryParams.template_id;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      const [totalViews, totalTries, totalDownloads] = await Promise.all([
        AnalyticsService.getCountMixedDateRange('TEMPLATE_VIEWS', filters, additionalFilters),
        AnalyticsService.getCountMixedDateRange('TEMPLATE_TRIES', filters, additionalFilters),
        AnalyticsService.getCountMixedDateRange('TEMPLATE_DOWNLOADS', filters, additionalFilters)
      ]);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: {
          template_views: {
            total_count: totalViews
          },
          template_tries: {
            total_count: totalTries
          },
          template_downloads: {
            total_count: totalDownloads
          },
          date_range: {
            start_date: queryParams.start_date,
            end_date: queryParams.end_date
          }
        }
      });
    } catch (error) {
      logger.error('Error fetching template downloads summary:', { 
        error: error.message, 
        stack: error.stack,
        query: req.validatedQuery 
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getSignups(req, res) {
    try {
      const queryParams = req.validatedQuery;

      const filters = {
        start_date: queryParams.start_date,
        end_date: queryParams.end_date,
        start_time: queryParams.start_time,
        end_time: queryParams.end_time,
        provider: queryParams.provider,
        user_id: queryParams.user_id
      };

      const signups = await AnalyticsService.getSignups(filters);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: signups
      });
    } catch (error) {
      logger.error('Error fetching signup analytics:', {
        error: error.message,
        stack: error.stack,
        query: req.validatedQuery
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getLogins(req, res) {
    try {
      const queryParams = req.validatedQuery;

      const filters = {
        start_date: queryParams.start_date,
        end_date: queryParams.end_date,
        start_time: queryParams.start_time,
        end_time: queryParams.end_time,
        provider: queryParams.provider,
        user_id: queryParams.user_id
      };

      const logins = await AnalyticsService.getLogins(filters);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: logins
      });
    } catch (error) {
      logger.error('Error fetching login analytics:', {
        error: error.message,
        stack: error.stack,
        query: req.validatedQuery
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getAuthAnalyticsSummary(req, res) {
    try {
      const queryParams = req.validatedQuery;

      const filters = {
        start_date: queryParams.start_date,
        end_date: queryParams.end_date,
        start_time: queryParams.start_time,
        end_time: queryParams.end_time,
        provider: queryParams.provider,
        user_id: queryParams.user_id
      };

      const additionalFilters = {};
      if (queryParams.provider) additionalFilters.provider = queryParams.provider;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      const totalSignups = await AnalyticsService.getCountMixedDateRange('SIGNUPS', filters, additionalFilters);
      const totalLogins = await AnalyticsService.getCountMixedDateRange('LOGINS', filters, additionalFilters);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: {
          signups: {
            total_count: totalSignups
          },
          logins: {
            total_count: totalLogins
          },
          date_range: {
            start_date: queryParams.start_date,
            end_date: queryParams.end_date
          }
        }
      });
    } catch (error) {
      logger.error('Error fetching auth analytics summary:', {
        error: error.message,
        stack: error.stack,
        query: req.validatedQuery
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getPurchases(req, res) {
    try {
      const queryParams = req.validatedQuery;

      const filters = {
        start_date: queryParams.start_date,
        end_date: queryParams.end_date,
        start_time: queryParams.start_time,
        end_time: queryParams.end_time,
        plan_id: queryParams.plan_id,
        plan_name: queryParams.plan_name,
        plan_type: queryParams.plan_type,
        payment_provider: queryParams.payment_provider,
        currency: queryParams.currency,
        user_id: queryParams.user_id
      };

      const purchases = await AnalyticsService.getPurchases(filters);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: purchases
      });
    } catch (error) {
      logger.error('Error fetching purchases analytics:', {
        error: error.message,
        stack: error.stack,
        query: req.validatedQuery
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getPurchasesSummary(req, res) {
    try {
      const queryParams = req.validatedQuery;

      const filters = {
        start_date: queryParams.start_date,
        end_date: queryParams.end_date,
        start_time: queryParams.start_time,
        end_time: queryParams.end_time,
        plan_id: queryParams.plan_id,
        plan_name: queryParams.plan_name,
        plan_type: queryParams.plan_type,
        payment_provider: queryParams.payment_provider,
        currency: queryParams.currency,
        user_id: queryParams.user_id
      };

      const additionalFilters = {};
      if (queryParams.plan_id) additionalFilters.plan_id = queryParams.plan_id;
      if (queryParams.plan_name) additionalFilters.plan_name = queryParams.plan_name;
      if (queryParams.plan_type) additionalFilters.plan_type = queryParams.plan_type;
      if (queryParams.payment_provider) additionalFilters.payment_provider = queryParams.payment_provider;
      if (queryParams.currency) additionalFilters.currency = queryParams.currency;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      const totalPurchases = await AnalyticsService.getCountMixedDateRange('PURCHASES', filters, additionalFilters);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: {
          purchases: {
            total_count: totalPurchases
          },
          date_range: {
            start_date: queryParams.start_date,
            end_date: queryParams.end_date
          }
        }
      });
    } catch (error) {
      logger.error('Error fetching purchases summary:', {
        error: error.message,
        stack: error.stack,
        query: req.validatedQuery
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }
}

module.exports = AnalyticsController;
'use strict';

const i18next = require('i18next');
const AnalyticsService = require('../services/analytics.service');
const TimezoneService = require('../services/timezone.service');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const AnalyticsErrorHandler = require('../middlewares/analytics.error.handler');
const logger = require('../../../config/lib/logger');

class AnalyticsController {
  static async getCharacterCreations(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      
      // Convert client timezone dates to UTC for database queries
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const additionalFilters = {};
      if (queryParams.gender) additionalFilters.gender = queryParams.gender;
      if (queryParams.character_id) additionalFilters.character_id = queryParams.character_id;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      let characterCreations;
      if (queryParams.group_by) {
        characterCreations = await AnalyticsService.queryMixedDateRangeGrouped('CHARACTER_CREATIONS', utcFilters, additionalFilters, queryParams.group_by);
      } else {
        characterCreations = await AnalyticsService.queryMixedDateRange('CHARACTER_CREATIONS', utcFilters, additionalFilters);
      }

      // Convert UTC results back to client timezone
      const convertedResults = TimezoneService.convertFromUTC(characterCreations, timezone);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: convertedResults
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
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      
      // Convert client timezone dates to UTC for database queries
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const additionalFilters = {};
      if (queryParams.gender) additionalFilters.gender = queryParams.gender;
      if (queryParams.character_id) additionalFilters.character_id = queryParams.character_id;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      let characterTrainings;
      if (queryParams.group_by) {
        characterTrainings = await AnalyticsService.queryMixedDateRangeGrouped('CHARACTER_TRAININGS', utcFilters, additionalFilters, queryParams.group_by);
      } else {
        characterTrainings = await AnalyticsService.queryMixedDateRange('CHARACTER_TRAININGS', utcFilters, additionalFilters);
      }

      // Convert UTC results back to client timezone
      const convertedResults = TimezoneService.convertFromUTC(characterTrainings, timezone);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: convertedResults
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
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      
      // Convert client timezone dates to UTC for database queries
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const additionalFilters = {};
      if (queryParams.output_type) additionalFilters.output_type = queryParams.output_type;
      if (queryParams.aspect_ratio) additionalFilters.aspect_ratio = queryParams.aspect_ratio;
      if (queryParams.orientation) additionalFilters.orientation = queryParams.orientation;
      if (queryParams.generation_type) additionalFilters.generation_type = queryParams.generation_type;
      if (queryParams.template_id) additionalFilters.template_id = queryParams.template_id;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      let templateViews;
      if (queryParams.group_by) {
        templateViews = await AnalyticsService.queryMixedDateRangeGrouped('TEMPLATE_VIEWS', utcFilters, additionalFilters, queryParams.group_by);
      } else {
        templateViews = await AnalyticsService.queryMixedDateRange('TEMPLATE_VIEWS', utcFilters, additionalFilters);
      }

      // Convert UTC results back to client timezone
      const convertedResults = TimezoneService.convertFromUTC(templateViews, timezone);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: convertedResults
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
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      
      // Convert client timezone dates to UTC for database queries
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const additionalFilters = {};
      if (queryParams.output_type) additionalFilters.output_type = queryParams.output_type;
      if (queryParams.aspect_ratio) additionalFilters.aspect_ratio = queryParams.aspect_ratio;
      if (queryParams.orientation) additionalFilters.orientation = queryParams.orientation;
      if (queryParams.generation_type) additionalFilters.generation_type = queryParams.generation_type;
      if (queryParams.template_id) additionalFilters.template_id = queryParams.template_id;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      let templateTries;
      if (queryParams.group_by) {
        templateTries = await AnalyticsService.queryMixedDateRangeGrouped('TEMPLATE_TRIES', utcFilters, additionalFilters, queryParams.group_by);
      } else {
        templateTries = await AnalyticsService.queryMixedDateRange('TEMPLATE_TRIES', utcFilters, additionalFilters);
      }

      // Convert UTC results back to client timezone
      const convertedResults = TimezoneService.convertFromUTC(templateTries, timezone);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: convertedResults
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
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      
      // Convert client timezone dates to UTC for database queries
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const additionalFilters = {};
      if (queryParams.output_type) additionalFilters.output_type = queryParams.output_type;
      if (queryParams.aspect_ratio) additionalFilters.aspect_ratio = queryParams.aspect_ratio;
      if (queryParams.orientation) additionalFilters.orientation = queryParams.orientation;
      if (queryParams.generation_type) additionalFilters.generation_type = queryParams.generation_type;
      if (queryParams.template_id) additionalFilters.template_id = queryParams.template_id;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      let templateDownloads;
      if (queryParams.group_by) {
        templateDownloads = await AnalyticsService.queryMixedDateRangeGrouped('TEMPLATE_DOWNLOADS', utcFilters, additionalFilters, queryParams.group_by);
      } else {
        templateDownloads = await AnalyticsService.queryMixedDateRange('TEMPLATE_DOWNLOADS', utcFilters, additionalFilters);
      }

      // Convert UTC results back to client timezone
      const convertedResults = TimezoneService.convertFromUTC(templateDownloads, timezone);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: convertedResults
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
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      
      // Convert client timezone dates to UTC for database queries
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const additionalFilters = {};
      if (queryParams.gender) additionalFilters.gender = queryParams.gender;
      if (queryParams.character_id) additionalFilters.character_id = queryParams.character_id;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      const [totalCreations, totalTrainings] = await Promise.all([
        AnalyticsService.getCountMixedDateRange('CHARACTER_CREATIONS', utcFilters, additionalFilters),
        AnalyticsService.getCountMixedDateRange('CHARACTER_TRAININGS', utcFilters, additionalFilters)
      ]);

      // Convert date range back to client timezone for response
      const convertedDateRange = TimezoneService.convertDateRangeFromUTC(
        queryParams.start_date,
        queryParams.end_date,
        timezone
      );

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: {
          character_creations: {
            total_count: totalCreations
          },
          character_trainings: {
            total_count: totalTrainings
          },
          date_range: convertedDateRange
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
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      
      // Convert client timezone dates to UTC for database queries
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const additionalFilters = {};
      if (queryParams.output_type) additionalFilters.output_type = queryParams.output_type;
      if (queryParams.aspect_ratio) additionalFilters.aspect_ratio = queryParams.aspect_ratio;
      if (queryParams.orientation) additionalFilters.orientation = queryParams.orientation;
      if (queryParams.generation_type) additionalFilters.generation_type = queryParams.generation_type;
      if (queryParams.template_id) additionalFilters.template_id = queryParams.template_id;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      const [totalViews, totalTries] = await Promise.all([
        AnalyticsService.getCountMixedDateRange('TEMPLATE_VIEWS', utcFilters, additionalFilters),
        AnalyticsService.getCountMixedDateRange('TEMPLATE_TRIES', utcFilters, additionalFilters)
      ]);

      // Convert date range back to client timezone for response
      const convertedDateRange = TimezoneService.convertDateRangeFromUTC(
        queryParams.start_date,
        queryParams.end_date,
        timezone
      );

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: {
          template_views: {
            total_count: totalViews
          },
          template_tries: {
            total_count: totalTries
          },
          date_range: convertedDateRange
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
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      
      // Convert client timezone dates to UTC for database queries
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const additionalFilters = {};
      if (queryParams.output_type) additionalFilters.output_type = queryParams.output_type;
      if (queryParams.aspect_ratio) additionalFilters.aspect_ratio = queryParams.aspect_ratio;
      if (queryParams.orientation) additionalFilters.orientation = queryParams.orientation;
      if (queryParams.generation_type) additionalFilters.generation_type = queryParams.generation_type;
      if (queryParams.template_id) additionalFilters.template_id = queryParams.template_id;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      const [totalViews, totalTries, totalDownloads] = await Promise.all([
        AnalyticsService.getCountMixedDateRange('TEMPLATE_VIEWS', utcFilters, additionalFilters),
        AnalyticsService.getCountMixedDateRange('TEMPLATE_TRIES', utcFilters, additionalFilters),
        AnalyticsService.getCountMixedDateRange('TEMPLATE_DOWNLOADS', utcFilters, additionalFilters)
      ]);

      // Convert date range back to client timezone for response
      const convertedDateRange = TimezoneService.convertDateRangeFromUTC(
        queryParams.start_date,
        queryParams.end_date,
        timezone
      );

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
          date_range: convertedDateRange
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
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();

      // Convert client timezone dates to UTC for database queries
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const filters = {
        ...utcFilters,
        provider: queryParams.provider,
        user_id: queryParams.user_id
      };

      let signups;
      if (queryParams.group_by) {
        const additionalFilters = {};
        if (queryParams.provider) additionalFilters.provider = queryParams.provider;
        if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;
        signups = await AnalyticsService.queryMixedDateRangeGrouped('SIGNUPS', utcFilters, additionalFilters, queryParams.group_by);
      } else {
        signups = await AnalyticsService.getSignups(filters);
      }

      // Convert UTC results back to client timezone
      const convertedResults = TimezoneService.convertFromUTC(signups, timezone);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: convertedResults
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
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();

      // Convert client timezone dates to UTC for database queries
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const filters = {
        ...utcFilters,
        provider: queryParams.provider,
        user_id: queryParams.user_id
      };

      let logins;
      if (queryParams.group_by) {
        const additionalFilters = {};
        if (queryParams.provider) additionalFilters.provider = queryParams.provider;
        if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;
        logins = await AnalyticsService.queryMixedDateRangeGrouped('LOGINS', utcFilters, additionalFilters, queryParams.group_by);
      } else {
        logins = await AnalyticsService.getLogins(filters);
      }

      // Convert UTC results back to client timezone
      const convertedResults = TimezoneService.convertFromUTC(logins, timezone);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: convertedResults
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
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();

      // Convert client timezone dates to UTC for database queries
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const filters = {
        ...utcFilters,
        provider: queryParams.provider,
        user_id: queryParams.user_id
      };

      const additionalFilters = {};
      if (queryParams.provider) additionalFilters.provider = queryParams.provider;
      if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;

      const totalSignups = await AnalyticsService.getCountMixedDateRange('SIGNUPS', utcFilters, additionalFilters);
      const totalLogins = await AnalyticsService.getCountMixedDateRange('LOGINS', utcFilters, additionalFilters);

      // Convert date range back to client timezone for response
      const convertedDateRange = TimezoneService.convertDateRangeFromUTC(
        queryParams.start_date,
        queryParams.end_date,
        timezone
      );

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: {
          signups: {
            total_count: totalSignups
          },
          logins: {
            total_count: totalLogins
          },
          date_range: convertedDateRange
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
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();

      // Convert client timezone dates to UTC for database queries
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const filters = {
        ...utcFilters,
        plan_id: queryParams.plan_id,
        plan_name: queryParams.plan_name,
        plan_type: queryParams.plan_type,
        payment_provider: queryParams.payment_provider,
        currency: queryParams.currency,
        user_id: queryParams.user_id
      };

      let purchases;
      if (queryParams.group_by) {
        const additionalFilters = {};
        if (queryParams.plan_id) additionalFilters.plan_id = queryParams.plan_id;
        if (queryParams.plan_name) additionalFilters.plan_name = queryParams.plan_name;
        if (queryParams.plan_type) additionalFilters.plan_type = queryParams.plan_type;
        if (queryParams.payment_provider) additionalFilters.payment_provider = queryParams.payment_provider;
        if (queryParams.currency) additionalFilters.currency = queryParams.currency;
        if (queryParams.user_id) additionalFilters.user_id = queryParams.user_id;
        purchases = await AnalyticsService.queryMixedDateRangeGrouped('PURCHASES', utcFilters, additionalFilters, queryParams.group_by);
      } else {
        purchases = await AnalyticsService.getPurchases(filters);
      }

      // Convert UTC results back to client timezone
      const convertedResults = TimezoneService.convertFromUTC(purchases, timezone);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: convertedResults
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
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();

      // Convert client timezone dates to UTC for database queries
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const filters = {
        ...utcFilters,
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

      const totalPurchases = await AnalyticsService.getCountMixedDateRange('PURCHASES', utcFilters, additionalFilters);

      // Convert date range back to client timezone for response
      const convertedDateRange = TimezoneService.convertDateRangeFromUTC(
        queryParams.start_date,
        queryParams.end_date,
        timezone
      );

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: {
          purchases: {
            total_count: totalPurchases
          },
          date_range: convertedDateRange
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
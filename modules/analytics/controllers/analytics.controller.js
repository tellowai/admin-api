'use strict';

const i18next = require('i18next');
const config = require('../../../config/config');
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

  static async getTemplateSuccesses(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();

      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const additionalFilters = {};
      if (queryParams.output_type) additionalFilters.output_type = queryParams.output_type;
      if (queryParams.generation_type) additionalFilters.generation_type = queryParams.generation_type;
      if (queryParams.template_id) additionalFilters.template_id = queryParams.template_id;

      let templateSuccesses;
      if (queryParams.group_by) {
        templateSuccesses = await AnalyticsService.queryMixedDateRangeGrouped('TEMPLATE_SUCCESSES', utcFilters, additionalFilters, queryParams.group_by);
      } else {
        templateSuccesses = await AnalyticsService.queryMixedDateRange('TEMPLATE_SUCCESSES', utcFilters, additionalFilters);
      }

      const convertedResults = TimezoneService.convertFromUTC(templateSuccesses, timezone);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: convertedResults
      });
    } catch (error) {
      logger.error('Error fetching template successes analytics:', { error: error.message, stack: error.stack, query: req.validatedQuery });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getTemplateFailures(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();

      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const additionalFilters = {};
      if (queryParams.output_type) additionalFilters.output_type = queryParams.output_type;
      if (queryParams.generation_type) additionalFilters.generation_type = queryParams.generation_type;
      if (queryParams.template_id) additionalFilters.template_id = queryParams.template_id;

      let templateFailures;
      if (queryParams.group_by) {
        templateFailures = await AnalyticsService.queryMixedDateRangeGrouped('TEMPLATE_FAILURES', utcFilters, additionalFilters, queryParams.group_by);
      } else {
        templateFailures = await AnalyticsService.queryMixedDateRange('TEMPLATE_FAILURES', utcFilters, additionalFilters);
      }

      const convertedResults = TimezoneService.convertFromUTC(templateFailures, timezone);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: convertedResults
      });
    } catch (error) {
      logger.error('Error fetching template failures analytics:', { error: error.message, stack: error.stack, query: req.validatedQuery });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getTopTemplatesByGeneration(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        null,
        null,
        timezone
      );
      const filters = {
        ...utcFilters,
        page: queryParams.page || 1,
        limit: queryParams.limit || 20
      };
      let data = await AnalyticsService.getTopTemplatesByGeneration(filters);
      const publicBucket = config.os2?.r2?.public?.bucket;
      const publicBucketUrl = config.os2?.r2?.public?.bucketUrl;
      data = (data || []).map((item) => {
        let thumb_frame_url = null;
        const isImage = (item.template_output_type || '').toLowerCase() === 'image';
        if (isImage && item.thumb_frame_asset_key && publicBucketUrl) {
          thumb_frame_url = `${publicBucketUrl}/${item.thumb_frame_asset_key}`;
        }
        if (!thumb_frame_url && item.thumb_frame_asset_key && item.thumb_frame_bucket) {
          const isPublic = item.thumb_frame_bucket === 'public' ||
            item.thumb_frame_bucket === publicBucket;
          if (isPublic && publicBucketUrl) {
            thumb_frame_url = `${publicBucketUrl}/${item.thumb_frame_asset_key}`;
          }
        }
        if (!thumb_frame_url && item.cf_r2_url) {
          thumb_frame_url = item.cf_r2_url;
        }
        const { thumb_frame_bucket, thumb_frame_asset_key, cf_r2_url, ...rest } = item;
        return { ...rest, thumb_frame_url };
      });
      return res.status(HTTP_STATUS_CODES.OK).json({ data });
    } catch (error) {
      logger.error('Error fetching top templates by generation:', { error: error.message, stack: error.stack, query: req.validatedQuery });
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

  static async getCredits(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();

      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const filters = {
        ...utcFilters,
        reason: queryParams.reason,
        country: queryParams.country,
        group_by: queryParams.group_by
      };

      const data = await AnalyticsService.getCreditsDailyStats(filters);
      const convertedResults = TimezoneService.convertFromUTC(data || [], timezone);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: convertedResults
      });
    } catch (error) {
      logger.error('Error fetching credits analytics:', {
        error: error.message,
        stack: error.stack,
        query: req.validatedQuery
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getCreditsSummary(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();

      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const filters = {
        ...utcFilters,
        reason: queryParams.reason,
        country: queryParams.country
      };

      const [summary, allTimeSummary] = await Promise.all([
        AnalyticsService.getCreditsSummary(filters),
        AnalyticsService.getCreditsSummaryAllTime(filters)
      ]);

      const convertedDateRange = TimezoneService.convertDateRangeFromUTC(
        queryParams.start_date,
        queryParams.end_date,
        timezone
      );

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: {
          credits_issued: summary?.total_issued ?? 0,
          credits_consumed: summary?.total_deducted ?? 0,
          credits_deducted: summary?.total_deducted ?? 0,
          system_balance_outstanding: summary?.system_balance_outstanding ?? 0,
          total_issued: summary?.total_issued ?? 0,
          total_deducted: summary?.total_deducted ?? 0,
          users_receiving_count: summary?.users_receiving_count ?? 0,
          users_spending_count: summary?.users_spending_count ?? 0,
          date_range: convertedDateRange,
          all_time: {
            total_issued: allTimeSummary?.total_issued ?? 0,
            total_deducted: allTimeSummary?.total_deducted ?? 0,
            system_balance_outstanding: allTimeSummary?.system_balance_outstanding ?? 0
          }
        }
      });
    } catch (error) {
      logger.error('Error fetching credits summary:', {
        error: error.message,
        stack: error.stack,
        query: req.validatedQuery
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getCreditsStuckCounts(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();

      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        queryParams.start_time,
        queryParams.end_time,
        timezone
      );

      const filters = { ...utcFilters };
      const data = await AnalyticsService.getCreditsStuckCounts(filters);
      const convertedResults = TimezoneService.convertFromUTC(data || [], timezone);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: convertedResults
      });
    } catch (error) {
      logger.error('Error fetching credits stuck counts:', {
        error: error.message,
        stack: error.stack,
        query: req.validatedQuery
      });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getAIExecutionSummary(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        null,
        null,
        timezone
      );
      const filters = {
        ...utcFilters,
        template_id: queryParams.template_id,
        provider_name: queryParams.provider_name,
        model_name: queryParams.model_name
      };
      const data = await AnalyticsService.getAIExecutionSummary(filters);
      return res.status(HTTP_STATUS_CODES.OK).json({ data: data || null });
    } catch (error) {
      logger.error('Error fetching AI execution summary:', { error: error.message, query: req.validatedQuery });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getAIExecutionByModel(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        null,
        null,
        timezone
      );
      const filters = {
        ...utcFilters,
        template_id: queryParams.template_id,
        provider_name: queryParams.provider_name,
        model_name: queryParams.model_name
      };
      const data = await AnalyticsService.getAIExecutionByModel(filters);
      const convertedResults = TimezoneService.convertFromUTC(data || [], timezone);
      return res.status(HTTP_STATUS_CODES.OK).json({ data: convertedResults });
    } catch (error) {
      logger.error('Error fetching AI execution by model:', { error: error.message, query: req.validatedQuery });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getAIExecutionByDay(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        null,
        null,
        timezone
      );
      const filters = {
        ...utcFilters,
        template_id: queryParams.template_id,
        provider_name: queryParams.provider_name,
        model_name: queryParams.model_name
      };
      const data = await AnalyticsService.getAIExecutionByDay(filters);
      const convertedResults = TimezoneService.convertFromUTC(data || [], timezone);
      return res.status(HTTP_STATUS_CODES.OK).json({ data: convertedResults });
    } catch (error) {
      logger.error('Error fetching AI execution by day:', { error: error.message, query: req.validatedQuery });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getAIExecutionCostByTemplate(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        null,
        null,
        timezone
      );
      const filters = {
        ...utcFilters,
        provider_name: queryParams.provider_name,
        model_name: queryParams.model_name
      };
      const data = await AnalyticsService.getAIExecutionCostByTemplate(filters);
      return res.status(HTTP_STATUS_CODES.OK).json({ data: data || [] });
    } catch (error) {
      logger.error('Error fetching AI execution cost by template:', { error: error.message, query: req.validatedQuery });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getAERenderingSummary(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        null,
        null,
        timezone
      );
      const filters = {
        ...utcFilters,
        template_id: queryParams.template_id,
        ae_version: queryParams.ae_version
      };
      const data = await AnalyticsService.getAERenderingSummary(filters);
      return res.status(HTTP_STATUS_CODES.OK).json({ data: data || null });
    } catch (error) {
      logger.error('Error fetching AE rendering summary:', { error: error.message, query: req.validatedQuery });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getAERenderingByVersion(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        null,
        null,
        timezone
      );
      const filters = {
        ...utcFilters,
        template_id: queryParams.template_id,
        ae_version: queryParams.ae_version
      };
      const data = await AnalyticsService.getAERenderingByVersion(filters);
      return res.status(HTTP_STATUS_CODES.OK).json({ data: data || [] });
    } catch (error) {
      logger.error('Error fetching AE rendering by version:', { error: error.message, query: req.validatedQuery });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getAERenderingByDay(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        null,
        null,
        timezone
      );
      const filters = {
        ...utcFilters,
        template_id: queryParams.template_id,
        ae_version: queryParams.ae_version
      };
      const data = await AnalyticsService.getAERenderingByDay(filters);
      const convertedResults = TimezoneService.convertFromUTC(data || [], timezone);
      return res.status(HTTP_STATUS_CODES.OK).json({ data: convertedResults });
    } catch (error) {
      logger.error('Error fetching AE rendering by day:', { error: error.message, query: req.validatedQuery });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getAIExecutionCostByDay(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        null,
        null,
        timezone
      );
      const filters = {
        ...utcFilters,
        template_id: queryParams.template_id,
        provider_name: queryParams.provider_name,
        model_name: queryParams.model_name
      };
      const data = await AnalyticsService.getAIExecutionCostByDay(filters);
      const convertedResults = TimezoneService.convertFromUTC(data || [], timezone);
      return res.status(HTTP_STATUS_CODES.OK).json({ data: convertedResults });
    } catch (error) {
      logger.error('Error fetching AI execution cost by day:', { error: error.message, query: req.validatedQuery });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getAIExecutionByErrorCategory(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        null,
        null,
        timezone
      );
      const filters = {
        ...utcFilters,
        template_id: queryParams.template_id,
        provider_name: queryParams.provider_name,
        model_name: queryParams.model_name
      };
      const data = await AnalyticsService.getAIExecutionByErrorCategory(filters);
      return res.status(HTTP_STATUS_CODES.OK).json({ data: data || [] });
    } catch (error) {
      logger.error('Error fetching AI execution by error category:', { error: error.message, query: req.validatedQuery });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getAERenderingByDayWithStatus(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        null,
        null,
        timezone
      );
      const filters = {
        ...utcFilters,
        template_id: queryParams.template_id,
        ae_version: queryParams.ae_version
      };
      const data = await AnalyticsService.getAERenderingByDayWithStatus(filters);
      const convertedResults = TimezoneService.convertFromUTC(data || [], timezone);
      return res.status(HTTP_STATUS_CODES.OK).json({ data: convertedResults });
    } catch (error) {
      logger.error('Error fetching AE rendering by day with status:', { error: error.message, query: req.validatedQuery });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getAERenderingStepsByDay(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        null,
        null,
        timezone
      );
      const filters = {
        ...utcFilters,
        template_id: queryParams.template_id,
        ae_version: queryParams.ae_version
      };
      const data = await AnalyticsService.getAERenderingStepsByDay(filters);
      const convertedResults = TimezoneService.convertFromUTC(data || [], timezone);
      return res.status(HTTP_STATUS_CODES.OK).json({ data: convertedResults });
    } catch (error) {
      logger.error('Error fetching AE rendering steps by day:', { error: error.message, query: req.validatedQuery });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }

  static async getAERenderingByErrorCategory(req, res) {
    try {
      const queryParams = req.validatedQuery;
      const timezone = queryParams.tz || TimezoneService.getDefaultTimezone();
      const utcFilters = TimezoneService.convertToUTC(
        queryParams.start_date,
        queryParams.end_date,
        null,
        null,
        timezone
      );
      const filters = {
        ...utcFilters,
        template_id: queryParams.template_id,
        ae_version: queryParams.ae_version
      };
      const data = await AnalyticsService.getAERenderingByErrorCategory(filters);
      return res.status(HTTP_STATUS_CODES.OK).json({ data: data || [] });
    } catch (error) {
      logger.error('Error fetching AE rendering by error category:', { error: error.message, query: req.validatedQuery });
      AnalyticsErrorHandler.handleAnalyticsErrors(error, res);
    }
  }
}

module.exports = AnalyticsController;
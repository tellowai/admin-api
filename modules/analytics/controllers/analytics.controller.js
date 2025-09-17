'use strict';

const i18next = require('i18next');
const AnalyticsModel = require('../models/analytics.model');
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
        end_time: queryParams.end_time,
        gender: queryParams.gender,
        character_id: queryParams.character_id,
        user_id: queryParams.user_id
      };

      const characterCreations = await AnalyticsModel.queryCharacterCreations(filters);

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
        end_time: queryParams.end_time,
        gender: queryParams.gender,
        character_id: queryParams.character_id,
        user_id: queryParams.user_id
      };

      const characterTrainings = await AnalyticsModel.queryCharacterTrainings(filters);

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
        end_time: queryParams.end_time,
        output_type: queryParams.output_type,
        aspect_ratio: queryParams.aspect_ratio,
        orientation: queryParams.orientation,
        generation_type: queryParams.generation_type,
        template_id: queryParams.template_id,
        user_id: queryParams.user_id
      };

      const templateViews = await AnalyticsModel.queryTemplateViews(filters);

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
        end_time: queryParams.end_time,
        output_type: queryParams.output_type,
        aspect_ratio: queryParams.aspect_ratio,
        orientation: queryParams.orientation,
        generation_type: queryParams.generation_type,
        template_id: queryParams.template_id,
        user_id: queryParams.user_id
      };

      const templateTries = await AnalyticsModel.queryTemplateTries(filters);

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

  static async getCharacterAnalyticsSummary(req, res) {
    try {
      const queryParams = req.validatedQuery;
      
      const filters = {
        start_date: queryParams.start_date,
        end_date: queryParams.end_date,
        start_time: queryParams.start_time,
        end_time: queryParams.end_time,
        gender: queryParams.gender,
        character_id: queryParams.character_id,
        user_id: queryParams.user_id
      };

      const [creationsCount, trainingsCount] = await Promise.all([
        AnalyticsModel.getCharacterCreationsCount(filters),
        AnalyticsModel.getCharacterTrainingsCount(filters)
      ]);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: {
          character_creations: {
            total_count: creationsCount
          },
          character_trainings: {
            total_count: trainingsCount
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
        end_time: queryParams.end_time,
        output_type: queryParams.output_type,
        aspect_ratio: queryParams.aspect_ratio,
        orientation: queryParams.orientation,
        generation_type: queryParams.generation_type,
        template_id: queryParams.template_id,
        user_id: queryParams.user_id
      };

      const [viewsCount, triesCount] = await Promise.all([
        AnalyticsModel.getTemplateViewsCount(filters),
        AnalyticsModel.getTemplateTriesCount(filters)
      ]);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: {
          template_views: {
            total_count: viewsCount
          },
          template_tries: {
            total_count: triesCount
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

  static async getTemplateDownloads(req, res) {
    try {
      const queryParams = req.validatedQuery;
      
      const filters = {
        start_date: queryParams.start_date,
        end_date: queryParams.end_date,
        start_time: queryParams.start_time,
        end_time: queryParams.end_time,
        output_type: queryParams.output_type,
        aspect_ratio: queryParams.aspect_ratio,
        orientation: queryParams.orientation,
        generation_type: queryParams.generation_type,
        template_id: queryParams.template_id,
        user_id: queryParams.user_id
      };

      const templateDownloads = await AnalyticsModel.queryTemplateDownloads(filters);

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

  static async getTemplateDownloadsSummary(req, res) {
    try {
      const queryParams = req.validatedQuery;
      
      const filters = {
        start_date: queryParams.start_date,
        end_date: queryParams.end_date,
        start_time: queryParams.start_time,
        end_time: queryParams.end_time,
        output_type: queryParams.output_type,
        aspect_ratio: queryParams.aspect_ratio,
        orientation: queryParams.orientation,
        generation_type: queryParams.generation_type,
        template_id: queryParams.template_id,
        user_id: queryParams.user_id
      };

      const [viewsCount, triesCount, downloadsCount] = await Promise.all([
        AnalyticsModel.getTemplateViewsCount(filters),
        AnalyticsModel.getTemplateTriesCount(filters),
        AnalyticsModel.getTemplateDownloadsCount(filters)
      ]);

      return res.status(HTTP_STATUS_CODES.OK).json({
        data: {
          template_views: {
            total_count: viewsCount
          },
          template_tries: {
            total_count: triesCount
          },
          template_downloads: {
            total_count: downloadsCount
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
}

module.exports = AnalyticsController;

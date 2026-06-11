'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const HeroPreviewService = require('../services/hero.preview.service');
const TemplateModel = require('../models/template.model');
const logger = require('../../../config/lib/logger');

exports.generateHeroPreview = async function (req, res) {
  try {
    const { templateId } = req.params;
    const result = await HeroPreviewService.generateHeroPreviewPng(templateId);
    return res.status(HTTP_STATUS_CODES.OK).json({ data: result });
  } catch (error) {
    logger.error('generateHeroPreview failed', { error: error.message, templateId: req.params.templateId });
    const code = error.message || 'UNKNOWN';
    const status = code === 'TEMPLATE_NOT_FOUND'
      ? HTTP_STATUS_CODES.NOT_FOUND
      : HTTP_STATUS_CODES.BAD_REQUEST;
    return res.status(status).json({
      message: code,
      error_code: code,
    });
  }
};

exports.getHeroPreviewStatus = async function (req, res) {
  const { jobId } = req.query;
  if (!jobId) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'jobId required' });
  }
  const status = HeroPreviewService.getJobStatus(String(jobId));
  if (!status) {
    return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Job not found' });
  }
  return res.status(HTTP_STATUS_CODES.OK).json({ data: status });
};

exports.updateHeroFrameIndex = async function (req, res) {
  try {
    const { templateId } = req.params;
    let frameIndex = Number(req.body?.hero_frame_index);
    if (!Number.isFinite(frameIndex) || frameIndex < 0) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'Invalid hero_frame_index' });
    }

    const template = await TemplateModel.getTemplateById(templateId);
    if (!template) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Template not found' });
    }
    if (template.template_output_type === 'image') {
      frameIndex = 0;
    }

    await TemplateModel.updateTemplate(templateId, { hero_frame_index: frameIndex });
    return res.status(HTTP_STATUS_CODES.OK).json({
      data: { template_id: templateId, hero_frame_index: frameIndex },
    });
  } catch (error) {
    logger.error('updateHeroFrameIndex failed', { error: error.message });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: error.message });
  }
};

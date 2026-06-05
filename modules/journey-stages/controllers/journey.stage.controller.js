'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const JourneyStageModel = require('../models/journey.stage.model');
const TemplateJourneyStageModel = require('../models/template.journey.stage.model');
const logger = require('../../../config/lib/logger');

exports.listJourneyStages = async function (req, res) {
  try {
    const nicheId = req.query.niche_id ? Number(req.query.niche_id) : null;
    const data = nicheId
      ? await JourneyStageModel.listByNicheId(nicheId)
      : await JourneyStageModel.listAllActive();
    return res.status(HTTP_STATUS_CODES.OK).json({ data });
  } catch (err) {
    logger.error('listJourneyStages', { error: err.message });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: 'Failed to list journey stages' });
  }
};

exports.createJourneyStage = async function (req, res) {
  try {
    const body = req.body || {};
    const stageId = await JourneyStageModel.insert(body);
    const row = await JourneyStageModel.getById(stageId);
    return res.status(HTTP_STATUS_CODES.CREATED).json({ data: row });
  } catch (err) {
    logger.error('createJourneyStage', { error: err.message });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: 'Failed to create journey stage' });
  }
};

exports.updateJourneyStage = async function (req, res) {
  try {
    const stageId = req.params.stageId;
    await JourneyStageModel.update(stageId, req.body || {});
    const row = await JourneyStageModel.getById(stageId);
    return res.status(HTTP_STATUS_CODES.OK).json({ data: row });
  } catch (err) {
    logger.error('updateJourneyStage', { error: err.message });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: 'Failed to update journey stage' });
  }
};

exports.archiveJourneyStage = async function (req, res) {
  try {
    await JourneyStageModel.archive(req.params.stageId);
    return res.status(HTTP_STATUS_CODES.NO_CONTENT).send();
  } catch (err) {
    logger.error('archiveJourneyStage', { error: err.message });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: 'Failed to archive journey stage' });
  }
};

exports.reorderJourneyStages = async function (req, res) {
  try {
    const { niche_id: nicheId, stage_orders: stageOrders } = req.body || {};
    if (!nicheId || !Array.isArray(stageOrders)) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'niche_id and stage_orders required' });
    }
    for (const item of stageOrders) {
      if (item.stage_id && item.sequence_order != null) {
        await JourneyStageModel.update(item.stage_id, { sequence_order: item.sequence_order });
      }
    }
    const data = await JourneyStageModel.listByNicheId(nicheId);
    return res.status(HTTP_STATUS_CODES.OK).json({ data });
  } catch (err) {
    logger.error('reorderJourneyStages', { error: err.message });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: 'Failed to reorder' });
  }
};

exports.getTemplateJourneyStages = async function (req, res) {
  try {
    const stageIds = await TemplateJourneyStageModel.listStageIdsForTemplate(req.params.templateId);
    return res.status(HTTP_STATUS_CODES.OK).json({ data: { stage_ids: stageIds } });
  } catch (err) {
    logger.error('getTemplateJourneyStages', { error: err.message });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: 'Failed to load journey stages' });
  }
};

exports.setTemplateJourneyStages = async function (req, res) {
  try {
    const templateId = req.params.templateId;
    const stageIds = req.body?.stage_ids || [];
    await TemplateJourneyStageModel.replaceTemplateStages(templateId, stageIds);
    const assigned = await TemplateJourneyStageModel.listStageIdsForTemplate(templateId);
    return res.status(HTTP_STATUS_CODES.OK).json({ data: { stage_ids: assigned } });
  } catch (err) {
    logger.error('setTemplateJourneyStages', { error: err.message });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: 'Failed to assign journey stages' });
  }
};

exports.bulkAssignJourneyStage = async function (req, res) {
  try {
    const { template_ids: templateIds, stage_id: stageId } = req.body || {};
    if (!templateIds?.length || !stageId) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'template_ids and stage_id required' });
    }
    await TemplateJourneyStageModel.bulkAssignStage(templateIds, stageId);
    return res.status(HTTP_STATUS_CODES.NO_CONTENT).send();
  } catch (err) {
    logger.error('bulkAssignJourneyStage', { error: err.message });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: 'Failed to bulk assign' });
  }
};

'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const TemplateVariantModel = require('../models/template.variant.model');
const { enrichTemplateListCardsUrls } = require('../utils/template.list.card.enrich');
const logger = require('../../../config/lib/logger');

exports.getTemplateVariants = async function (req, res) {
  try {
    const templateId = req.params.templateId;
    const meta = await TemplateVariantModel.getTemplateGroupMeta(templateId);
    if (!meta) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Template not found' });
    }
    if (!meta.group_id) {
      return res.status(HTTP_STATUS_CODES.OK).json({ data: [] });
    }
    const siblings = await TemplateVariantModel.listTemplatesByGroupId(meta.group_id, { useMaster: true });
    const data = await enrichTemplateListCardsUrls(siblings);
    return res.status(HTTP_STATUS_CODES.OK).json({ data });
  } catch (err) {
    logger.error('getTemplateVariants admin', { error: err.message });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: 'Failed to list variants' });
  }
};

exports.linkVariants = async function (req, res) {
  try {
    const anchorTemplateId = req.params.templateId;
    const { sibling_template_ids: siblingIds = [], variant_labels: variantLabels = {} } = req.body || {};

    const anchor = await TemplateVariantModel.getTemplateGroupMeta(anchorTemplateId);
    if (!anchor) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Template not found' });
    }

    const ids = [...new Set([anchorTemplateId, ...siblingIds].filter(Boolean))];
    if (ids.length < 2) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'At least one sibling template id is required'
      });
    }

    let groupId = anchor.group_id;
    if (!groupId) {
      groupId = TemplateVariantModel.newGroupId();
      await TemplateVariantModel.updateTemplateGroupId(anchorTemplateId, groupId);
    }

    for (const tid of ids) {
      if (tid === anchorTemplateId) continue;
      const row = await TemplateVariantModel.getTemplateGroupMeta(tid);
      if (!row) {
        return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: `Template not found: ${tid}` });
      }
      if (row.group_id && row.group_id !== groupId) {
        const orphans = await TemplateVariantModel.listTemplateIdsByGroupId(row.group_id);
        if (orphans.length === 1) {
          await TemplateVariantModel.clearTemplateGroupId(orphans[0]);
        }
      }
      await TemplateVariantModel.updateTemplateGroupId(tid, groupId);
      if (variantLabels[tid] != null) {
        await TemplateVariantModel.updateTemplateVariantLabel(tid, variantLabels[tid]);
      }
    }

    if (variantLabels[anchorTemplateId] != null) {
      await TemplateVariantModel.updateTemplateVariantLabel(anchorTemplateId, variantLabels[anchorTemplateId]);
    }

    const rows = await TemplateVariantModel.listTemplatesByGroupId(groupId, { useMaster: true });
    const data = await enrichTemplateListCardsUrls(rows);
    return res.status(HTTP_STATUS_CODES.CREATED).json({ data, group_id: groupId });
  } catch (err) {
    logger.error('linkVariants admin', { error: err.message });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: 'Failed to link variants' });
  }
};

exports.unlinkVariant = async function (req, res) {
  try {
    const templateId = req.params.templateId;
    const meta = await TemplateVariantModel.getTemplateGroupMeta(templateId);
    if (!meta) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Template not found' });
    }
    if (!meta.group_id) {
      return res.status(HTTP_STATUS_CODES.NO_CONTENT).send();
    }

    const groupId = meta.group_id;
    await TemplateVariantModel.clearTemplateGroupId(templateId);

    const remaining = await TemplateVariantModel.listTemplateIdsByGroupId(groupId);
    if (remaining.length === 1) {
      await TemplateVariantModel.clearTemplateGroupId(remaining[0]);
    }

    return res.status(HTTP_STATUS_CODES.NO_CONTENT).send();
  } catch (err) {
    logger.error('unlinkVariant admin', { error: err.message });
    return res.status(HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR).json({ message: 'Failed to unlink variant' });
  }
};

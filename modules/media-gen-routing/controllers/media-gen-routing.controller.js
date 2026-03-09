'use strict';

const MediaGenRoutingModel = require('../models/media-gen-routing.model');
const AiRegistryModel = require('../../ai-registries/models/ai-registry.model');
const MediaGenRoutingAuditService = require('../services/media-gen-routing-audit.service');
const { redisClient } = require('../../../config/lib/redis');

const ROUTING_CACHE_INVALIDATE_KEY = 'media_gen:routing:invalid';

function getAdminId(req) {
  return req.user?.id ?? req.user?.userId ?? req.user?.admin_id ?? null;
}

function invalidateRoutingCache() {
  if (redisClient && typeof redisClient.set === 'function') {
    redisClient.set(ROUTING_CACHE_INVALIDATE_KEY, Date.now().toString(), (err) => {
      if (err) console.error('Redis routing cache invalidation failed:', err);
    });
  }
}

exports.listCapabilities = async function (req, res) {
  try {
    const rows = await MediaGenRoutingModel.listCapabilities();
    return res.json({ data: rows });
  } catch (err) {
    console.error('media-gen-routing listCapabilities:', err);
    return res.status(500).json({ message: 'Failed to list capabilities' });
  }
};

exports.listStyles = async function (req, res) {
  try {
    const rows = await MediaGenRoutingModel.listStyles();
    return res.json({ data: rows });
  } catch (err) {
    console.error('media-gen-routing listStyles:', err);
    return res.status(500).json({ message: 'Failed to list styles' });
  }
};

exports.listRoutingRules = async function (req, res) {
  try {
    const filters = {
      capability_id: req.query.capability_id ? parseInt(req.query.capability_id, 10) : null,
      style_id: req.query.style_id ? parseInt(req.query.style_id, 10) : null,
      user_tier: req.query.user_tier || null
    };
    const rows = await MediaGenRoutingModel.listRoutingRules(filters);
    return res.json({ data: rows });
  } catch (err) {
    console.error('media-gen-routing listRoutingRules:', err);
    return res.status(500).json({ message: 'Failed to list routing rules' });
  }
};

exports.createRoutingRule = async function (req, res) {
  try {
    const { capability_id, style_id, user_tier, primary_amr_id, fallback_amr_id, priority_weight, is_active } = req.body;
    if (!capability_id || !style_id || !primary_amr_id) {
      return res.status(400).json({ message: 'capability_id, style_id, and primary_amr_id are required' });
    }
    const id = await MediaGenRoutingModel.createRoutingRule({
      capability_id,
      style_id,
      user_tier: user_tier || 'default',
      primary_amr_id,
      fallback_amr_id: fallback_amr_id || null,
      priority_weight: priority_weight ?? 100,
      is_active: is_active !== false
    });
    await MediaGenRoutingAuditService.log(id, 'create', getAdminId(req), null, req.body).catch(() => {});
    invalidateRoutingCache();
    const rule = await MediaGenRoutingModel.getRoutingRuleById(id);
    return res.status(201).json({ data: rule });
  } catch (err) {
    console.error('media-gen-routing createRoutingRule:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Rule already exists for this capability+style+tier' });
    }
    return res.status(500).json({ message: 'Failed to create routing rule' });
  }
};

exports.updateRoutingRule = async function (req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const before = await MediaGenRoutingModel.getRoutingRuleById(id);
    const { primary_amr_id, fallback_amr_id, priority_weight, is_active } = req.body;
    const affected = await MediaGenRoutingModel.updateRoutingRule(id, {
      primary_amr_id,
      fallback_amr_id,
      priority_weight,
      is_active
    });
    if (affected === 0) {
      return res.status(404).json({ message: 'Routing rule not found' });
    }
    const rule = await MediaGenRoutingModel.getRoutingRuleById(id);
    await MediaGenRoutingAuditService.log(id, 'update', getAdminId(req), before, rule).catch(() => {});
    invalidateRoutingCache();
    return res.json({ data: rule });
  } catch (err) {
    console.error('media-gen-routing updateRoutingRule:', err);
    return res.status(500).json({ message: 'Failed to update routing rule' });
  }
};

exports.deleteRoutingRule = async function (req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const before = await MediaGenRoutingModel.getRoutingRuleById(id);
    const affected = await MediaGenRoutingModel.deleteRoutingRule(id);
    if (affected === 0) {
      return res.status(404).json({ message: 'Routing rule not found' });
    }
    await MediaGenRoutingAuditService.log(id, 'delete', getAdminId(req), before, null).catch(() => {});
    invalidateRoutingCache();
    return res.status(204).send();
  } catch (err) {
    console.error('media-gen-routing deleteRoutingRule:', err);
    return res.status(500).json({ message: 'Failed to delete routing rule' });
  }
};

exports.listModelsForRouting = async function (req, res) {
  try {
    const models = await AiRegistryModel.listAiModels({ status: 'active' }, { limit: 200, offset: 0 });
    return res.json({ data: models });
  } catch (err) {
    console.error('media-gen-routing listModelsForRouting:', err);
    return res.status(500).json({ message: 'Failed to list models' });
  }
};

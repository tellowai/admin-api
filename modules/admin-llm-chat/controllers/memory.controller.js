'use strict';

const HTTP = require('../../core/controllers/httpcodes.server.controller').CODES;
const MemoryModel = require('../models/memory.model');
const EpisodicModel = require('../models/episodic.model');
const memoryService = require('../services/memory.service');
const profileService = require('../services/memory.profile.service');

exports.listMemories = async (req, res) => {
  const userId = req.user.userId;
  const rows = await MemoryModel.listByUser(userId);
  return res.status(HTTP.OK).json({
    data: rows.map((m) => ({
      memory_key: m.memory_key,
      memory_value: m.memory_value,
      memory_type: m.memory_type,
      source_conversation_id: m.source_conversation_id,
      updated_at: m.updated_at,
    })),
  });
};

exports.getMemory = async (req, res) => {
  const userId = req.user.userId;
  const row = await MemoryModel.getByKeyForUser(userId, req.params.memoryKey);
  if (!row) return res.status(HTTP.NOT_FOUND).json({ code: 'NOT_FOUND' });
  return res.status(HTTP.OK).json({ data: row });
};

exports.upsertMemory = async (req, res) => {
  const userId = req.user.userId;
  const key = req.params.memoryKey;
  const value = req.validatedBody.value;
  await memoryService.upsertSemanticMemory(userId, key, value, {
    metadataJson: { source: 'api' },
  });
  const row = await MemoryModel.getByKeyForUser(userId, key);
  return res.status(HTTP.OK).json({ data: row });
};

exports.deleteMemory = async (req, res) => {
  const userId = req.user.userId;
  await MemoryModel.deleteMemory(userId, req.params.memoryKey);
  return res.status(HTTP.OK).json({ data: { deleted: true } });
};

exports.listEpisodicMemories = async (req, res) => {
  const userId = req.user.userId;
  const rows = await EpisodicModel.listByUser(userId);
  return res.status(HTTP.OK).json({
    data: rows.map((e) => ({
      episodic_id: e.episodic_id,
      conversation_id: e.conversation_id,
      summary_text: e.summary_text,
      topics: e.topics_json,
      created_at: e.created_at,
    })),
  });
};

exports.deleteEpisodicMemory = async (req, res) => {
  const userId = req.user.userId;
  await EpisodicModel.softDelete(userId, req.params.episodicId);
  return res.status(HTTP.OK).json({ data: { deleted: true } });
};

exports.getProfile = async (req, res) => {
  const profile = await profileService.getProfileForUser(req.user.userId);
  return res.status(HTTP.OK).json({ data: profile });
};

exports.updateProfile = async (req, res) => {
  const profile = await profileService.updateProfile(req.user.userId, req.validatedBody);
  return res.status(HTTP.OK).json({ data: profile });
};

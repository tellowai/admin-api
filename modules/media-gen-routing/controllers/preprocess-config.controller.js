'use strict';

const PreprocessConfigModel = require('../models/preprocess-config.model');

function getAdminId(req) {
  return req.user?.id ?? req.user?.userId ?? req.user?.admin_id ?? null;
}

exports.list = async function (req, res) {
  try {
    const filters = {
      amr_id: req.query.amr_id ? parseInt(req.query.amr_id, 10) : null,
      config_type: req.query.config_type || null,
      is_active: req.query.is_active !== undefined ? req.query.is_active === 'true' : null,
    };
    const rows = await PreprocessConfigModel.listAll(filters);
    return res.json({ data: rows });
  } catch (err) {
    console.error('preprocess-config list:', err);
    return res.status(500).json({ message: 'Failed to list preprocess configs' });
  }
};

exports.getById = async function (req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await PreprocessConfigModel.getById(id);
    if (!row) return res.status(404).json({ message: 'Not found' });
    return res.json({ data: row });
  } catch (err) {
    console.error('preprocess-config getById:', err);
    return res.status(500).json({ message: 'Failed to get preprocess config' });
  }
};

exports.create = async function (req, res) {
  try {
    const { amr_id, config_type, title, content_text, content_json, is_active, priority } = req.body;
    if (!amr_id || !config_type) {
      return res.status(400).json({ message: 'amr_id and config_type are required' });
    }
    const id = await PreprocessConfigModel.create({
      amr_id,
      config_type,
      title,
      content_text,
      content_json,
      is_active,
      priority,
    });
    const row = await PreprocessConfigModel.getById(id);
    return res.status(201).json({ data: row });
  } catch (err) {
    console.error('preprocess-config create:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Config already exists for this model + config_type' });
    }
    return res.status(500).json({ message: 'Failed to create preprocess config' });
  }
};

exports.update = async function (req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { title, content_text, content_json, is_active, priority } = req.body;
    const affected = await PreprocessConfigModel.update(id, { title, content_text, content_json, is_active, priority });
    if (affected === 0) {
      return res.status(404).json({ message: 'Not found' });
    }
    const row = await PreprocessConfigModel.getById(id);
    return res.json({ data: row });
  } catch (err) {
    console.error('preprocess-config update:', err);
    return res.status(500).json({ message: 'Failed to update preprocess config' });
  }
};

exports.remove = async function (req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const affected = await PreprocessConfigModel.remove(id);
    if (affected === 0) {
      return res.status(404).json({ message: 'Not found' });
    }
    return res.status(204).send();
  } catch (err) {
    console.error('preprocess-config remove:', err);
    return res.status(500).json({ message: 'Failed to delete preprocess config' });
  }
};

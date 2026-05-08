'use strict';

const config = require('../../../config/config');
const ScriptFontService = require('../services/script.font.service');
const ScriptFontManifestService = require('../services/script.font.manifest.service');
const ScriptFontModel = require('../models/script.font.model');

function sendError(res, err, fallbackStatus) {
  const code = err.statusCode || fallbackStatus || 500;
  if (code >= 500) {
    console.error('script-font controller error:', err);
  }
  return res.status(code).send({ message: err.message || 'Error' });
}

exports.listRegistry = async function (req, res) {
  try {
    return res.status(200).send({ registry: ScriptFontService.listRegistry() });
  } catch (err) {
    return sendError(res, err, 500);
  }
};

/** Public bucket name for presigned uploads (must match script-font source allowlist). */
exports.getUploadConfig = async function (req, res) {
  try {
    const pub = config.os2 && config.os2.r2 && config.os2.r2.public;
    if (!pub || !pub.bucket) {
      return res.status(503).send({ message: 'Object storage is not configured' });
    }
    return res.status(200).send({
      bucket: pub.bucket,
      bucketUrl: pub.bucketUrl || null
    });
  } catch (err) {
    return sendError(res, err, 500);
  }
};

exports.getManifest = async function (req, res) {
  try {
    let payload = await ScriptFontManifestService.getManifestOrNull();
    if (!payload) {
      payload = await ScriptFontManifestService.buildAndCacheManifest();
    }
    return res.status(200).send(payload);
  } catch (err) {
    return sendError(res, err, 500);
  }
};

exports.listAssets = async function (req, res) {
  try {
    const rows = await ScriptFontService.listAssets({
      script_key: req.query.script_key,
      status: req.query.status
    });
    return res.status(200).send({ data: rows });
  } catch (err) {
    return sendError(res, err, 500);
  }
};

exports.getAsset = async function (req, res) {
  try {
    const row = await ScriptFontService.getAssetWithSources(req.params.id);
    if (!row) return res.status(404).send({ message: 'Asset not found' });
    return res.status(200).send(row);
  } catch (err) {
    return sendError(res, err, 500);
  }
};

exports.createAsset = async function (req, res) {
  try {
    const row = await ScriptFontService.createAsset(req.body || {});
    return res.status(201).send(row);
  } catch (err) {
    if (err.message && err.message.includes('required')) {
      return sendError(res, err, 400);
    }
    return sendError(res, err, 500);
  }
};

exports.updateAsset = async function (req, res) {
  try {
    const row = await ScriptFontService.updateAsset(req.params.id, req.body || {});
    return res.status(200).send(row);
  } catch (err) {
    if (err.message === 'Asset not found') return res.status(404).send({ message: err.message });
    if (err.message && (err.message.includes('Invalid') || err.message.includes('Cannot mix') || err.message.includes('requires'))) {
      return sendError(res, err, 400);
    }
    return sendError(res, err, 500);
  }
};

exports.deleteAsset = async function (req, res) {
  try {
    await ScriptFontService.deleteAsset(req.params.id);
    return res.status(204).send();
  } catch (err) {
    return sendError(res, err, 500);
  }
};

exports.addSource = async function (req, res) {
  try {
    const sources = await ScriptFontService.addSource(req.params.id, req.body || {});
    return res.status(200).send({ sources });
  } catch (err) {
    if (err.message === 'Asset not found') return res.status(404).send({ message: err.message });
    if (err.message && (err.message.includes('required') || err.message.includes('Remove') || err.message.includes('Only one'))) {
      return sendError(res, err, 400);
    }
    return sendError(res, err, 500);
  }
};

exports.deleteSource = async function (req, res) {
  try {
    await ScriptFontService.deleteSource(req.params.assetId, req.params.sourceId);
    return res.status(204).send();
  } catch (err) {
    if (err.message === 'Source not found') return res.status(404).send({ message: err.message });
    return sendError(res, err, 500);
  }
};

exports.listDefaults = async function (req, res) {
  try {
    const rows = await ScriptFontService.listDefaults();
    return res.status(200).send({ data: rows });
  } catch (err) {
    return sendError(res, err, 500);
  }
};

exports.putDefault = async function (req, res) {
  try {
    const scriptKey = req.params.scriptKey;
    if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, 'font_asset_id')) {
      return res.status(400).send({ message: 'font_asset_id is required (null to clear default)' });
    }
    await ScriptFontService.setDefault(scriptKey, req.body.font_asset_id);
    const rows = await ScriptFontService.listDefaults();
    return res.status(200).send({ data: rows });
  } catch (err) {
    if (err.statusCode === 409) return sendError(res, err, 409);
    if (err.message && err.message.includes('Invalid')) return sendError(res, err, 400);
    return sendError(res, err, 500);
  }
};

exports.getTemplateOverrides = async function (req, res) {
  try {
    const rows = await ScriptFontModel.listOverridesByTemplateId(req.params.templateId, { useMaster: false });
    const map = {};
    for (const r of rows || []) {
      map[r.script_key] = r.font_asset_id;
    }
    return res.status(200).send({ overrides: map });
  } catch (err) {
    return sendError(res, err, 500);
  }
};

exports.putTemplateOverrides = async function (req, res) {
  try {
    const overrides = (req.body && req.body.overrides) || req.body || {};
    await ScriptFontService.replaceTemplateOverrides(req.params.templateId, overrides);
    const rows = await ScriptFontModel.listOverridesByTemplateId(req.params.templateId, { useMaster: true });
    const map = {};
    for (const r of rows || []) {
      map[r.script_key] = r.font_asset_id;
    }
    return res.status(200).send({ overrides: map });
  } catch (err) {
    if (err.statusCode === 409) return sendError(res, err, 409);
    return sendError(res, err, 500);
  }
};

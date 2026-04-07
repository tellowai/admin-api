'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const AppThemeDbo = require('../models/sdui.app-theme.model');

function parseJson(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

const MAX_THEME_KEYS = 256;
const MAX_THEME_KEY_LEN = 128;
const MAX_THEME_VALUE_LEN = 8192;

/**
 * @param {object} obj
 * @param {string} label  'light' | 'dark' (for error messages)
 * @returns {{ ok: boolean, message?: string, data?: object }}
 */
function validateThemeTokensObject(obj, label) {
  if (Array.isArray(obj)) {
    return { ok: false, message: `${label}: tokens must be a JSON object, not an array` };
  }
  if (obj == null || typeof obj !== 'object') {
    return { ok: true, data: {} };
  }
  const keys = Object.keys(obj);
  if (keys.length > MAX_THEME_KEYS) {
    return { ok: false, message: `${label}: too many tokens (max ${MAX_THEME_KEYS})` };
  }
  const out = {};
  for (const k of keys) {
    const key = String(k).trim();
    if (!key) continue;
    if (key.length > MAX_THEME_KEY_LEN) {
      return { ok: false, message: `${label}: token name too long` };
    }
    const val = obj[k];
    if (val == null) continue;
    const str = typeof val === 'string' ? val : String(val);
    let trimmed = str.trim();
    if (/gradient\s*\(/i.test(trimmed)) {
      trimmed = trimmed.replace(/;\s*$/, '').trim();
    }
    if (!trimmed) continue;
    if (trimmed.length > MAX_THEME_VALUE_LEN) {
      return {
        ok: false,
        message: `${label}: value for "${key}" exceeds ${MAX_THEME_VALUE_LEN} characters (gradients must fit in this limit)`,
      };
    }
    out[key] = trimmed;
  }
  return { ok: true, data: out };
}

function formatRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    light: parseJson(row.light_tokens),
    dark: parseJson(row.dark_tokens),
    status: row.status,
    notes: row.notes || null,
    publishedAt: row.published_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET /admin/app-theme — returns current published + latest draft.
 */
exports.getAppTheme = async function (req, res, next) {
  try {
    const published = await AppThemeDbo.getPublished();
    const draft = await AppThemeDbo.getLatestDraft();
    return res.status(HTTP_STATUS_CODES.OK).json({
      message: 'OK',
      data: {
        published: formatRow(published),
        draft: formatRow(draft),
      },
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /admin/app-theme/versions — all versions (newest first).
 */
exports.getVersions = async function (req, res, next) {
  try {
    const rows = await AppThemeDbo.getAllVersions();
    return res.status(HTTP_STATUS_CODES.OK).json({
      message: 'OK',
      data: rows.map(formatRow),
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /admin/app-theme — create or update draft.
 * Body: { id?, version, light, dark, notes? }
 */
exports.saveDraft = async function (req, res, next) {
  try {
    const body = req.body || {};
    const version = parseInt(body.version, 10);
    if (!Number.isFinite(version) || version < 0) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'version must be a non-negative integer' });
    }

    const rawLight = body.light && typeof body.light === 'object' ? body.light : {};
    const rawDark = body.dark && typeof body.dark === 'object' ? body.dark : {};
    const lightCheck = validateThemeTokensObject(rawLight, 'light');
    if (!lightCheck.ok) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: lightCheck.message });
    }
    const darkCheck = validateThemeTokensObject(rawDark, 'dark');
    if (!darkCheck.ok) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: darkCheck.message });
    }
    const light = lightCheck.data;
    const dark = darkCheck.data;
    const lightJson = JSON.stringify(light);
    const darkJson = JSON.stringify(dark);
    const user = req.user?.email || req.user?.username || null;
    const notes = body.notes || null;

    if (body.id) {
      const affected = await AppThemeDbo.updateDraft(body.id, {
        version, lightTokens: lightJson, darkTokens: darkJson, notes, updatedBy: user,
      });
      if (!affected) {
        return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Draft not found or already published' });
      }
      return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Draft updated', data: { id: body.id } });
    }

    const newId = await AppThemeDbo.createDraft({
      version, lightTokens: lightJson, darkTokens: darkJson, notes, createdBy: user,
    });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Draft created', data: { id: newId } });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /admin/app-theme/:id/publish
 */
exports.publish = async function (req, res, next) {
  try {
    const { id } = req.params;
    const row = await AppThemeDbo.getById(id);
    if (!row) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Theme version not found' });
    }
    if (row.status === 'published') {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'Already published' });
    }
    if (row.status === 'archived') {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({ message: 'Cannot publish an archived version — rollback first' });
    }

    const user = req.user?.email || req.user?.username || null;
    await AppThemeDbo.publish(id, user);
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Published successfully' });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /admin/app-theme/rollback/:id — clone that version as a new draft.
 */
exports.rollback = async function (req, res, next) {
  try {
    const { id } = req.params;
    const row = await AppThemeDbo.getById(id);
    if (!row) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({ message: 'Theme version not found' });
    }

    const user = req.user?.email || req.user?.username || null;
    const newId = await AppThemeDbo.createDraft({
      version: row.version + 1,
      lightTokens: typeof row.light_tokens === 'string' ? row.light_tokens : JSON.stringify(row.light_tokens || {}),
      darkTokens: typeof row.dark_tokens === 'string' ? row.dark_tokens : JSON.stringify(row.dark_tokens || {}),
      notes: `Rolled back from v${row.version} (id: ${row.id})`,
      createdBy: user,
    });
    return res.status(HTTP_STATUS_CODES.OK).json({ message: 'Rollback draft created', data: { id: newId } });
  } catch (err) {
    return next(err);
  }
};

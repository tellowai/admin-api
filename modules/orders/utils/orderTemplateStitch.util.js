'use strict';

const TemplateModel = require('../../templates/models/template.model');
const PackModel = require('../../packs/models/pack.model');

/**
 * @param {unknown} raw - JSON string or already-parsed object from mysql2
 * @returns {object|null}
 */
function parseTransactionNotesObject(raw) {
  if (raw == null || raw === '') return null;
  let parsed = raw;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(parsed)) {
    parsed = parsed.toString('utf8');
  }
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (parsed && typeof parsed === 'object') {
    return parsed;
  }
  return null;
}

/**
 * @param {unknown} raw - JSON string or already-parsed object from mysql2
 * @returns {string|null}
 */
function parseTemplateIdFromTransactionNotes(raw) {
  const parsed = parseTransactionNotesObject(raw);
  if (!parsed) return null;
  if (parsed.template_id != null && parsed.template_id !== '') {
    const tid = String(parsed.template_id).trim();
    return tid || null;
  }
  return null;
}

/**
 * Pack purchases store `pack_resource_id` (not `template_id`) on the order row.
 * @param {unknown} raw
 * @returns {string|null}
 */
function parsePackIdFromTransactionNotes(raw) {
  const parsed = parseTransactionNotesObject(raw);
  if (!parsed) return null;
  if (parsed.pack_resource_id != null && String(parsed.pack_resource_id).trim() !== '') {
    const pid = String(parsed.pack_resource_id).trim();
    return pid || null;
  }
  return null;
}

/**
 * Batch-load template names for template_ids found in orders.transaction_notes (no SQL joins).
 * @param {Array<{ transaction_notes?: unknown }>} rows
 * @returns {Promise<Record<string, string|null>>} template_id -> template_name (null if missing in DB)
 */
async function buildTemplateNameByIdMap(rows) {
  const templateIds = [
    ...new Set(
      (rows || [])
        .map((r) => parseTemplateIdFromTransactionNotes(r.transaction_notes))
        .filter(Boolean)
    )
  ];
  if (!templateIds.length) {
    return {};
  }
  const tplRows = await TemplateModel.getTemplatesByIdsForAnalytics(templateIds);
  const byId = {};
  for (const t of tplRows) {
    byId[t.template_id] = t.template_name != null ? String(t.template_name) : null;
  }
  const out = {};
  for (const id of templateIds) {
    out[id] = Object.prototype.hasOwnProperty.call(byId, id) ? byId[id] : null;
  }
  return out;
}

/**
 * Batch-load pack names for pack_resource_ids in orders.transaction_notes.
 * @param {Array<{ transaction_notes?: unknown }>} rows
 * @returns {Promise<Record<string, string|null>>}
 */
async function buildPackNameByIdMap(rows) {
  const packIds = [
    ...new Set(
      (rows || []).map((r) => parsePackIdFromTransactionNotes(r.transaction_notes)).filter(Boolean)
    )
  ];
  if (!packIds.length) {
    return {};
  }
  const packRows = await PackModel.getPacksByIdsForAnalytics(packIds);
  const byId = {};
  for (const p of packRows) {
    byId[p.pack_id] = p.pack_name != null ? String(p.pack_name) : null;
  }
  const out = {};
  for (const id of packIds) {
    out[id] = Object.prototype.hasOwnProperty.call(byId, id) ? byId[id] : null;
  }
  return out;
}

module.exports = {
  parseTransactionNotesObject,
  parseTemplateIdFromTransactionNotes,
  parsePackIdFromTransactionNotes,
  buildTemplateNameByIdMap,
  buildPackNameByIdMap
};

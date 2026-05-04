'use strict';

const TemplateModel = require('../../templates/models/template.model');

/**
 * @param {unknown} raw - JSON string or already-parsed object from mysql2
 * @returns {string|null}
 */
function parseTemplateIdFromTransactionNotes(raw) {
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
  if (parsed && typeof parsed === 'object' && parsed.template_id != null && parsed.template_id !== '') {
    const tid = String(parsed.template_id).trim();
    return tid || null;
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

module.exports = {
  parseTemplateIdFromTransactionNotes,
  buildTemplateNameByIdMap
};

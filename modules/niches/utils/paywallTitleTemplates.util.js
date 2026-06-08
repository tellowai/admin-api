'use strict';

function trimTemplate(value) {
  return String(value || '').trim();
}

exports.normalizePaywallTitleTemplates = function normalizePaywallTitleTemplates(raw) {
  if (raw == null) return [];

  if (Array.isArray(raw)) {
    return raw.map(trimTemplate).filter(Boolean);
  }

  if (typeof raw === 'object') {
    try {
      const serialized = JSON.stringify(raw);
      const parsed = JSON.parse(serialized);
      if (Array.isArray(parsed)) {
        return parsed.map(trimTemplate).filter(Boolean);
      }
    } catch {
      /* ignore */
    }
    return [];
  }

  const text = trimTemplate(raw);
  if (!text) return [];

  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map(trimTemplate).filter(Boolean);
      }
    } catch {
      /* fall through */
    }
  }

  return [text];
};

/**
 * MySQL JSON columns require a JSON text value (not a bare string or JS array binding).
 * @param {unknown} raw
 * @returns {string}
 */
exports.serializePaywallTitleTemplatesForDb = function serializePaywallTitleTemplatesForDb(raw) {
  const list = exports.normalizePaywallTitleTemplates(raw);
  return JSON.stringify(list);
};

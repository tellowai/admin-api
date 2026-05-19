'use strict';

/**
 * Extract default text from a Lottie text layer (ty 5).
 * @param {object} layer
 * @returns {string}
 */
function readTextLayerDefault(layer) {
  if (!layer?.t?.d) return '';
  const d = layer.t.d;
  if (d.k && Array.isArray(d.k) && d.k[0]?.s?.t != null) {
    return String(d.k[0].s.t);
  }
  if (d.s?.t != null) {
    return String(d.s.t);
  }
  return '';
}

/**
 * Walk layers (root + precomps) and collect text layers for LLM / match-fields.
 * @param {object} bodymovinJson
 * @returns {Array<{ layer_name: string, default_text: string, input_field_type: string, user_input_field_name: string, linked_layer_names: string[] }>}
 */
function extractCustomTextInputFieldsFromBodymovin(bodymovinJson) {
  const fields = [];
  const seenNames = new Set();
  const assetsById = new Map();
  if (Array.isArray(bodymovinJson?.assets)) {
    bodymovinJson.assets.forEach((a) => {
      if (a?.id != null) assetsById.set(String(a.id), a);
    });
  }

  const visit = (layers) => {
    if (!Array.isArray(layers)) return;
    for (const layer of layers) {
      if (!layer) continue;
      if (Number(layer.ty) === 5) {
        const layerName = String(layer.nm || layer.name || `Text ${fields.length + 1}`).trim();
        const norm = layerName.toLowerCase();
        if (seenNames.has(norm)) continue;
        seenNames.add(norm);
        const defaultText = readTextLayerDefault(layer);
        fields.push({
          layer_name: layerName,
          default_text: defaultText || layerName,
          input_field_type: 'short_text',
          user_input_field_name: layerName,
          linked_layer_names: []
        });
      } else if (Number(layer.ty) === 0 && layer.refId != null) {
        const asset = assetsById.get(String(layer.refId));
        if (asset?.layers) visit(asset.layers);
        else if (Array.isArray(layer.layers)) visit(layer.layers);
      }
    }
  };

  if (Array.isArray(bodymovinJson?.layers)) {
    visit(bodymovinJson.layers);
  }
  if (Array.isArray(bodymovinJson?.assets)) {
    bodymovinJson.assets.forEach((a) => {
      if (a?.layers) visit(a.layers);
    });
  }

  return fields;
}

/**
 * Compact summary for LLM context (avoid sending full JSON).
 * @param {object} bodymovinJson
 * @returns {object}
 */
function summarizeBodymovinForLlm(bodymovinJson) {
  const fr = Number(bodymovinJson?.fr) || 30;
  const ip = Number(bodymovinJson?.ip) || 0;
  const op = Number.isFinite(Number(bodymovinJson?.op)) ? Number(bodymovinJson.op) : 0;
  const textFields = extractCustomTextInputFieldsFromBodymovin(bodymovinJson);

  return {
    composition_name: bodymovinJson?.nm || null,
    width: bodymovinJson?.w || null,
    height: bodymovinJson?.h || null,
    frame_rate: fr,
    duration_seconds: op > ip ? (op - ip) / fr : 0,
    frame_count: Math.max(0, op - ip),
    text_layers: textFields.map((f) => ({
      layer_name: f.layer_name,
      default_text: f.default_text
    }))
  };
}

module.exports = {
  extractCustomTextInputFieldsFromBodymovin,
  summarizeBodymovinForLlm
};

'use strict';

const { randomUUID } = require('crypto');

/**
 * Normalize Bodymovin / AE layer name for comparisons.
 * @param {unknown} s
 * @returns {string}
 */
function normLayerName(s) {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * @param {object[]} clipWorkflows
 * @param {number} clipIndex
 * @param {string} variableKey
 * @param {string} nodeType
 * @returns {string}
 */
function wfNodeLabel(clipWorkflows, clipIndex, variableKey, nodeType) {
  const idx = Number(clipIndex);
  let wf = null;
  if (Array.isArray(clipWorkflows) && clipWorkflows.length) {
    const first = clipWorkflows[0];
    if (first && Array.isArray(first.nodes) && first.clip_index !== undefined) {
      wf = clipWorkflows.find((c) => Number(c.clip_index) === idx) || null;
    }
    if (!wf) wf = clipWorkflows[idx] || null;
  }
  if (!wf || !Array.isArray(wf.nodes)) {
    return variableKey || 'AI input';
  }
  const target = String(nodeType || '');
  const wantVk = variableKey != null ? String(variableKey) : '';
  for (const node of wf.nodes) {
    const t = String(node?.type || node?.system_node_type || node?.type_slug || '');
    if (t !== target) continue;
    const inputs = node?.data?.inputs && typeof node.data.inputs === 'object' ? node.data.inputs : {};
    const vk =
      inputs.variable_key != null && inputs.variable_key !== ''
        ? String(inputs.variable_key)
        : node?.data?.variable_key != null
          ? String(node.data.variable_key)
          : '';
    if (wantVk && vk !== wantVk) continue;
    const label =
      (node?.data?.label && String(node.data.label).trim()) ||
      (node?.label && String(node.label).trim()) ||
      vk ||
      target;
    return label;
  }
  return wantVk || 'AI input';
}

/**
 * Resolve a text binding to the asked user field id for grouping (user_input + linked chains).
 * @param {object[]} allBindings
 * @param {object} b
 * @param {Set<string>} [seen]
 * @returns {string|null}
 */
function resolveTextAskedFieldId(allBindings, b, seen = new Set()) {
  if (!b || b.slot_kind !== 'text') return null;
  const k = b.binding_kind;
  if (k === 'user_input' && b.user_input_field_id) {
    return String(b.user_input_field_id);
  }
  if (k === 'linked' && b.linked_to_slot_layer_name) {
    const parentLayer = normLayerName(b.linked_to_slot_layer_name);
    if (!parentLayer || seen.has(parentLayer)) return null;
    seen.add(parentLayer);
    const parentBinding = allBindings.find(
      (x) => x && x.slot_kind === 'text' && normLayerName(x.slot_layer_name) === parentLayer
    );
    if (!parentBinding) return null;
    return resolveTextAskedFieldId(allBindings, parentBinding, seen);
  }
  return null;
}

/**
 * Pure projection: modeled authoring → legacy consumer arrays.
 *
 * @param {{
 *   asked_user_input_fields?: object[],
 *   slot_bindings?: object[],
 *   clip_workflows?: object[],
 *   existing_image_input_fields_json?: object[],
 *   existing_video_uploads_json?: object[]
 * }} opts
 * @returns {{
 *   custom_text_input_fields: object[],
 *   image_input_fields_json: object[],
 *   video_uploads_json: object[]
 * }}
 */
function projectModeledToLegacy(opts = {}) {
  const asked = Array.isArray(opts.asked_user_input_fields) ? opts.asked_user_input_fields : [];
  const bindings = Array.isArray(opts.slot_bindings) ? opts.slot_bindings : [];
  const clipWorkflows = Array.isArray(opts.clip_workflows) ? opts.clip_workflows : [];
  const existingImg = Array.isArray(opts.existing_image_input_fields_json)
    ? opts.existing_image_input_fields_json
    : [];
  const existingVid = Array.isArray(opts.existing_video_uploads_json) ? opts.existing_video_uploads_json : [];

  const askedById = new Map(asked.map((a) => [String(a.id), a]));
  const imgByLayer = new Map(existingImg.map((r) => [normLayerName(r.layer_name), r]));
  const vidByLayer = new Map(existingVid.map((r) => [normLayerName(r.layer_name), r]));

  const textBindings = bindings
    .filter((b) => b && b.slot_kind === 'text')
    .sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0));

  const aiTextRows = [];
  const textGroups = new Map();

  for (const b of textBindings) {
    const bk = b.binding_kind;
    if (bk === 'unmapped' || bk === 'static') continue;

    if (bk === 'ai_workflow') {
      const aw = b.ai_workflow || {};
      const clipIdx = Number(aw.clip_index);
      const varKey = aw.variable_key != null ? String(aw.variable_key) : '';
      const nodeType = aw.node_type || 'USER_INPUT_TEXT';
      const layerName = normLayerName(b.slot_layer_name);
      if (!layerName) continue;
      const label = wfNodeLabel(clipWorkflows, clipIdx, varKey, nodeType);
      aiTextRows.push({
        _sort: Number(b.display_order) || 0,
        row: {
          layer_name: layerName,
          user_input_field_name: label,
          input_field_type: 'short_text',
          linked_layer_names: [],
          skip_user_input: true,
          variable_name: varKey || null
        }
      });
      continue;
    }

    const askedId = resolveTextAskedFieldId(bindings, b);
    if (!askedId) continue;
    const field = askedById.get(askedId);
    if (!field || field.kind !== 'text') continue;

    if (!textGroups.has(askedId)) textGroups.set(askedId, []);
    textGroups.get(askedId).push({
      sort: Number(b.display_order) || 0,
      layer: normLayerName(b.slot_layer_name)
    });
  }

  const groupRows = [];
  const groupEntries = [...textGroups.entries()].sort((A, B) => {
    const minA = Math.min(...A[1].map((x) => x.sort));
    const minB = Math.min(...B[1].map((x) => x.sort));
    return minA - minB;
  });

  for (const [askedId, items] of groupEntries) {
    const field = askedById.get(askedId);
    if (!field) continue;
    const sorted = items.slice().sort((a, b) => a.sort - b.sort);
    const layers = [...new Set(sorted.map((x) => x.layer).filter(Boolean))];
    if (layers.length === 0) continue;

    const primary = layers[0];
    const linked = layers.slice(1);

    const rawType = field.input_type || 'short_text';
    const input_field_type = rawType === 'text' ? 'short_text' : rawType;

    /** @type {Record<string, unknown>} */
    const row = {
      layer_name: primary,
      user_input_field_name: field.label || primary,
      input_field_type,
      linked_layer_names: linked
    };

    if (field.default_text != null && String(field.default_text) !== '') {
      row.default_text = String(field.default_text);
    }
    if (['date', 'datetime', 'time'].includes(input_field_type)) {
      if (field.date_format) row.format = field.date_format;
      if (field.rendering_date_format != null && String(field.rendering_date_format).trim() !== '') {
        row.rendering_date_format = String(field.rendering_date_format).trim();
      }
    }
    if (field.text_casing) row.text_casing = field.text_casing;
    if (field.nfd_field_code) row.nfd_field_code = field.nfd_field_code;
    if (field.is_optional === true) row.is_optional = true;
    if (field.variable_name != null && String(field.variable_name).trim() !== '') {
      row.variable_name = String(field.variable_name).trim();
    }

    groupRows.push({ _sort: Math.min(...items.map((x) => x.sort)), row });
  }

  groupRows.sort((a, b) => a._sort - b._sort);
  aiTextRows.sort((a, b) => a._sort - b._sort);

  const custom_text_input_fields = [
    ...groupRows.map((x) => x.row),
    ...aiTextRows.map((x) => x.row)
  ];

  // --- IMAGE ---
  const image_input_fields_json = [];
  const imageBindings = bindings
    .filter((b) => b && b.slot_kind === 'image')
    .sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0));

  for (const b of imageBindings) {
    const bk = b.binding_kind;
    if (bk === 'unmapped' || bk === 'linked') continue;
    const layerName = normLayerName(b.slot_layer_name);
    if (!layerName) continue;

    if (bk === 'ai_workflow') {
      const aw = b.ai_workflow || {};
      const clipIdx = aw.clip_index != null ? Number(aw.clip_index) : null;
      const varKey = aw.variable_key != null ? String(aw.variable_key) : null;
      const nodeType = aw.node_type || 'USER_INPUT_IMAGE';
      const prev = imgByLayer.get(layerName);
      const image_id = prev?.image_id || randomUUID();
      const label = wfNodeLabel(clipWorkflows, clipIdx != null ? clipIdx : 0, varKey || '', nodeType);
      /** @type {Record<string, unknown>} */
      const row = {
        image_id,
        layer_name: layerName,
        field_code: prev?.field_code ?? null,
        field_data_type: 'photo',
        user_input_field_name: label,
        clip_index: clipIdx,
        variable_key: varKey,
        label
      };
      if (prev?.reference_image) row.reference_image = prev.reference_image;
      if (prev?.is_optional === true) row.is_optional = true;
      image_input_fields_json.push(row);
      continue;
    }

    if (bk === 'user_input' && b.user_input_field_id) {
      const f = askedById.get(String(b.user_input_field_id));
      if (!f || f.kind !== 'image') continue;
      const prev = imgByLayer.get(layerName);
      const image_id = prev?.image_id || randomUUID();
      /** @type {Record<string, unknown>} */
      const row = {
        image_id,
        layer_name: layerName,
        field_code: f.nfd_field_code || null,
        field_data_type: 'photo',
        user_input_field_name: f.label || layerName,
        reference_image: f.reference_image || null,
        label: f.label || layerName
      };
      if (f.gender) row.gender = f.gender;
      if (f.is_optional === true) row.is_optional = true;
      image_input_fields_json.push(row);
    }
  }

  // --- VIDEO ---
  const video_uploads_json = [];
  const videoBindings = bindings
    .filter((b) => b && b.slot_kind === 'video')
    .sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0));

  for (const b of videoBindings) {
    const bk = b.binding_kind;
    if (bk === 'unmapped' || bk === 'linked') continue;
    const layerName = normLayerName(b.slot_layer_name);
    if (!layerName) continue;

    if (bk === 'ai_workflow') {
      const aw = b.ai_workflow || {};
      const clipIdx = aw.clip_index != null ? Number(aw.clip_index) : 0;
      const stepIdx = aw.step_index != null ? Number(aw.step_index) : 0;
      const varKey = aw.variable_key != null ? String(aw.variable_key) : null;
      const nodeType = aw.node_type || 'USER_INPUT_VIDEO';
      const prev = vidByLayer.get(layerName);
      const video_id = prev?.video_id || randomUUID();
      const label = wfNodeLabel(clipWorkflows, clipIdx, varKey || '', nodeType);
      /** @type {Record<string, unknown>} */
      const row = {
        video_id,
        layer_name: layerName,
        field_code: prev?.field_code ?? null,
        field_data_type: 'video',
        user_input_field_name: label,
        clip_index: clipIdx,
        step_index: stepIdx,
        variable_key: varKey,
        label
      };
      if (prev?.reference_image) row.reference_image = prev.reference_image;
      if (prev?.gender) row.gender = prev.gender;
      if (prev?.layer_time_start_sec != null && prev?.layer_time_end_sec != null) {
        row.layer_time_start_sec = prev.layer_time_start_sec;
        row.layer_time_end_sec = prev.layer_time_end_sec;
      }
      if (prev?.is_optional === true) row.is_optional = true;
      video_uploads_json.push(row);
      continue;
    }

    if (bk === 'user_input' && b.user_input_field_id) {
      const f = askedById.get(String(b.user_input_field_id));
      if (!f || f.kind !== 'video') continue;
      const prev = vidByLayer.get(layerName);
      const video_id = prev?.video_id || randomUUID();
      /** @type {Record<string, unknown>} */
      const row = {
        video_id,
        layer_name: layerName,
        field_code: f.nfd_field_code || null,
        field_data_type: 'video',
        user_input_field_name: f.label || layerName,
        clip_index: prev?.clip_index != null ? Number(prev.clip_index) : 0,
        step_index: prev?.step_index != null ? Number(prev.step_index) : 0,
        label: f.label || layerName
      };
      if (f.gender) row.gender = f.gender;
      if (prev?.variable_key) row.variable_key = prev.variable_key;
      if (prev?.reference_image) row.reference_image = prev.reference_image;
      if (prev?.layer_time_start_sec != null && prev?.layer_time_end_sec != null) {
        row.layer_time_start_sec = prev.layer_time_start_sec;
        row.layer_time_end_sec = prev.layer_time_end_sec;
      }
      if (f.is_optional === true || prev?.is_optional === true) row.is_optional = true;
      video_uploads_json.push(row);
    }
  }

  return {
    custom_text_input_fields,
    image_input_fields_json,
    video_uploads_json
  };
}

module.exports = {
  projectModeledToLegacy,
  normLayerName,
  wfNodeLabel
};

'use strict';

/**
 * Collect layer_name values that are "followers" of another field (linked layers).
 */
function collectLinkedSecondaryLayerNames(fields) {
  const set = new Set();
  if (!Array.isArray(fields)) return set;
  for (const f of fields) {
    const names = f?.linked_layer_names;
    if (!Array.isArray(names)) continue;
    for (const n of names) {
      if (n != null && n !== '') set.add(String(n));
    }
  }
  return set;
}

/**
 * Only fields the user edits in the app (exclude linked AE follower layers).
 */
function toPublicCustomTextInputFields(fields) {
  if (!Array.isArray(fields)) return fields;
  const secondary = collectLinkedSecondaryLayerNames(fields);
  return fields
    .filter((f) => {
      const ln = f?.layer_name;
      if (ln == null || ln === '') return true;
      return !secondary.has(String(ln));
    })
    .map((f) => {
      if (f == null || typeof f !== 'object') return f;
      const next = { ...f };
      delete next.linked_layer_names;
      delete next.use_custom_ae_text;
      delete next.text_output_template;
      return next;
    });
}

/**
 * User-submitted values for admin timeline: primary template fields only, one row per user_input_field_name.
 * @param {Array} generationFields - From resource_generations.additional_data.custom_text_input_fields
 * @param {Array|null} templateDefs - Template custom_text_input_fields definitions
 */
function filterGenerationCustomTextFieldsForDisplay(generationFields, templateDefs) {
  if (!Array.isArray(generationFields) || generationFields.length === 0) return [];

  const defs = Array.isArray(templateDefs) && templateDefs.length ? templateDefs : generationFields;
  const publicDefs = toPublicCustomTextInputFields(defs);
  const secondaryLayers = collectLinkedSecondaryLayerNames(defs);
  const primaryNames = new Set(
    publicDefs
      .map((f) => f?.user_input_field_name)
      .filter((n) => n != null && String(n).trim() !== '')
      .map((n) => String(n).trim())
  );

  const byName = new Map();
  for (const field of generationFields) {
    if (!field || typeof field !== 'object') continue;
    const layerName = field.layer_name != null ? String(field.layer_name).trim() : '';
    if (layerName && secondaryLayers.has(layerName)) continue;

    const fieldName = field.user_input_field_name != null ? String(field.user_input_field_name).trim() : '';
    if (!fieldName) continue;
    if (primaryNames.size > 0 && !primaryNames.has(fieldName)) continue;

    const val = field.value ?? field.text ?? null;
    if (val == null || String(val).trim() === '') continue;

    if (!byName.has(fieldName)) {
      byName.set(fieldName, field);
    }
  }

  if (publicDefs.length > 0) {
    const ordered = [];
    for (const def of publicDefs) {
      const name = def?.user_input_field_name != null ? String(def.user_input_field_name).trim() : '';
      if (name && byName.has(name)) ordered.push(byName.get(name));
    }
    if (ordered.length > 0) return ordered;
  }

  return [...byName.values()];
}

module.exports = {
  collectLinkedSecondaryLayerNames,
  toPublicCustomTextInputFields,
  filterGenerationCustomTextFieldsForDisplay
};

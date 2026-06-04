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
 * ClickHouse audit blob at SUBMIT — return as stored (labels + values at generation time).
 * Only drops empty values and AE linked follower layers; does not remap to today's template names.
 *
 * @param {Array} generationFields - resource_generations.additional_data.custom_text_input_fields
 * @param {Array|null} templateDefs - optional, to detect linked_layer_names on template
 */
function filterGenerationCustomTextFieldsForDisplay(generationFields, templateDefs) {
  if (!Array.isArray(generationFields) || generationFields.length === 0) return [];

  const defs =
    Array.isArray(templateDefs) && templateDefs.length ? templateDefs : generationFields;
  const secondary = collectLinkedSecondaryLayerNames(defs);

  const out = [];
  const seenNames = new Set();

  for (const field of generationFields) {
    if (!field || typeof field !== 'object') continue;

    const layerName = field.layer_name != null ? String(field.layer_name).trim() : '';
    if (layerName && secondary.has(layerName)) continue;

    const fieldName =
      field.user_input_field_name != null ? String(field.user_input_field_name).trim() : '';
    if (!fieldName) continue;

    const val = field.value ?? field.text ?? null;
    if (val == null || String(val).trim() === '') continue;

    const dedupeKey = fieldName.toLowerCase();
    if (seenNames.has(dedupeKey)) continue;
    seenNames.add(dedupeKey);

    out.push({ ...field });
  }

  return out;
}

module.exports = {
  collectLinkedSecondaryLayerNames,
  toPublicCustomTextInputFields,
  filterGenerationCustomTextFieldsForDisplay
};

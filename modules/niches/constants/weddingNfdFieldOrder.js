'use strict';

/**
 * Canonical display order for wedding template text fields after niche match-fields.
 * Each entry is a group of equivalent `field_code` values that share the same rank.
 * Codes are normalized (case, hyphens vs underscores) before lookup.
 *
 * Keep in sync with: photobop-admin-ui/src/components/templates/constants/weddingNfdFieldOrder.js
 */
const WEDDING_NFD_FIELD_CODE_ORDER = [
  ['family_name', 'family_surname'],
  ['bride_name'],
  ['groom_name'],
  ['bride_family_name'],
  ['bride_mother_name'],
  ['bride_father_name'],
  ['groom_family_name'],
  ['groom_mother_name'],
  ['groom_father_name'],
  [
    'ceremony_time',
    'wedding_time',
    'wedding_ceremony_time',
    'event_time',
    'event_start_time',
    'reception_time'
  ],
  [
    'wedding_date',
    'event_date',
    'ceremony_date',
    'date_of_wedding',
    'marriage_date',
    'wedding_day'
  ],
  [
    'wedding_venue',
    'venue',
    'venue_address',
    'location',
    'wedding_location',
    'ceremony_venue',
    'reception_venue',
    'event_venue'
  ]
];

function normalizeNfdFieldCodeKey(code) {
  if (code == null || code === '') return '';
  return String(code)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function rankNfdFieldCode(code) {
  const c = normalizeNfdFieldCodeKey(code);
  if (!c) return null;
  for (let i = 0; i < WEDDING_NFD_FIELD_CODE_ORDER.length; i++) {
    const group = WEDDING_NFD_FIELD_CODE_ORDER[i];
    for (let j = 0; j < group.length; j++) {
      if (normalizeNfdFieldCodeKey(group[j]) === c) {
        return i;
      }
    }
  }
  return null;
}

/**
 * Sort match-fields API rows: known wedding niche codes first (canonical order),
 * duplicate-of-primary (linked_layer_names) after same-code primary, unknown codes last (stable).
 */
function sortMatchedTextFieldsForDisplay(fields) {
  const arr = Array.isArray(fields) ? fields.map((f) => ({ ...f })) : [];
  arr.forEach((f, i) => {
    f._sortOrig = i;
  });
  arr.sort((a, b) => {
    const ra = rankNfdFieldCode(a.nfd_field_code);
    const rb = rankNfdFieldCode(b.nfd_field_code);
    const ia = ra !== null ? ra : 10000 + a._sortOrig;
    const ib = rb !== null ? rb : 10000 + b._sortOrig;
    if (ia !== ib) return ia - ib;
    const aDup =
      Array.isArray(a.linked_layer_names) && a.linked_layer_names.length > 0 ? 1 : 0;
    const bDup =
      Array.isArray(b.linked_layer_names) && b.linked_layer_names.length > 0 ? 1 : 0;
    if (aDup !== bDup) return aDup - bDup;
    return a._sortOrig - b._sortOrig;
  });
  arr.forEach((f) => {
    delete f._sortOrig;
  });
  return arr;
}

module.exports = {
  WEDDING_NFD_FIELD_CODE_ORDER,
  normalizeNfdFieldCodeKey,
  rankNfdFieldCode,
  sortMatchedTextFieldsForDisplay
};

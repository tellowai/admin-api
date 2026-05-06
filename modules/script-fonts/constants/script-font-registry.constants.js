'use strict';

/**
 * Allowed script_key values (must match photobop-workers script-font-registry.js).
 * Admin validates against this list; workers use the same keys for Unicode detection.
 */
const SCRIPT_FONT_REGISTRY = [
  { scriptKey: 'gurmukhi', label: 'Gurmukhi' },
  { scriptKey: 'gujarati', label: 'Gujarati' },
  { scriptKey: 'oriya', label: 'Oriya (Odia)' },
  { scriptKey: 'tamil', label: 'Tamil' },
  { scriptKey: 'telugu', label: 'Telugu' },
  { scriptKey: 'kannada', label: 'Kannada' },
  { scriptKey: 'devanagari', label: 'Devanagari' },
  { scriptKey: 'bengali', label: 'Bengali' },
  { scriptKey: 'malayalam', label: 'Malayalam' },
  { scriptKey: 'arabic', label: 'Arabic' },
  { scriptKey: 'thai', label: 'Thai' },
  { scriptKey: 'cjk_sc', label: 'Chinese (Simplified)' },
  { scriptKey: 'japanese', label: 'Japanese' }
];

const SCRIPT_KEYS = new Set(SCRIPT_FONT_REGISTRY.map((e) => e.scriptKey));

function isValidScriptKey(key) {
  return typeof key === 'string' && SCRIPT_KEYS.has(key);
}

module.exports = {
  SCRIPT_FONT_REGISTRY,
  SCRIPT_KEYS,
  isValidScriptKey
};

'use strict';

const crypto = require('crypto');

/**
 * Fixed shape: AAAA-BBB-CCC (4 + 3 + 3 alphanumeric segments, two hyphens).
 * Charset: A–Z except I and O, digits 2–9 (no 0/1). Aligned with photobop-api photo-booth validator.
 */
const BOOTH_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/i;

/**
 * Wedding-friendly, celebratory tone — no food / egg / produce / dining words (read-aloud safe for mixed
 * guests). Exactly 4 letters, a–z, no i / l / o. App hyphenates by position (4-3-3).
 */
const WORDS_4 = [
  'beam', 'dawn', 'star', 'peak', 'zest', 'jump', 'tame', 'warm', 'neat', 'mega', 'ruby', 'jade', 'snug',
  'pure', 'true', 'free', 'safe', 'snap', 'chat', 'surf', 'vast', 'keen', 'buzz', 'jazz', 'save', 'seat',
  'send', 'sent', 'team', 'tent', 'wave', 'yarn', 'year', 'best', 'feat', 'gate', 'gave', 'haze', 'heat',
  'just', 'mate', 'meet', 'next', 'pack', 'page', 'pass', 'gems', 'east', 'zany', 'bash', 'band', 'fest',
  'fete', 'wynn', 'apex', 'park', 'path', 'wand', 'cute', 'cyan', 'deck', 'dear', 'rare', 'gaze', 'puja',
  'raga', 'arch', 'mesh', 'acre', 'guru'
];

/**
 * Short bright / ceremony-adjacent tokens. Exactly 3 letters, same character rules; no food or egg cues.
 */
const WORDS_3 = [
  'sun', 'fun', 'zen', 'gem', 'ray', 'yes', 'yep', 'ace', 'jay', 'key', 'hug', 'jet', 'ken', 'kea', 'map',
  'hat', 'awe', 'bay', 'day', 'dew', 'max', 'tan', 'yay', 'spa', 'yea', 'wed', 'arc', 'art', 'hue', 'pax',
  'aum', 'sky', 'sea', 'fan', 'sum', 'era', 'dye'
];

const SUFFIX_CHARS = '23456789abcdefghjkmnpqrstuvwxyz';

function randomInt(max) {
  return crypto.randomInt(0, max);
}

function randomSuffix(len) {
  let s = '';
  for (let i = 0; i < len; i += 1) {
    s += SUFFIX_CHARS[randomInt(SUFFIX_CHARS.length)];
  }
  return s;
}

function pick(arr) {
  return arr[randomInt(arr.length)];
}

function generateHumanFriendlyBoothCode() {
  return `${pick(WORDS_4)}-${pick(WORDS_3)}-${randomSuffix(3)}`.toUpperCase();
}

/**
 * Uppercase, trim; if 10 alphanumeric chars, insert hyphens as 4-3-3.
 * @param {string} code
 * @returns {string}
 */
function normalizeBoothCode(code) {
  const trimmed = String(code || '').trim().toUpperCase();
  const compact = trimmed.replace(/\s+/g, '');
  if (BOOTH_CODE_PATTERN.test(compact)) return compact;
  const alnum = trimmed.replace(/[^A-HJ-NP-Z2-9]/g, '');
  if (alnum.length === 10) {
    const c = `${alnum.slice(0, 4)}-${alnum.slice(4, 7)}-${alnum.slice(7)}`;
    if (BOOTH_CODE_PATTERN.test(c)) return c;
  }
  return '';
}

function isValidBoothCode(code) {
  const s = normalizeBoothCode(code);
  return BOOTH_CODE_PATTERN.test(s);
}

module.exports = {
  BOOTH_CODE_PATTERN,
  generateHumanFriendlyBoothCode,
  normalizeBoothCode,
  isValidBoothCode
};

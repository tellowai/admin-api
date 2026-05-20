'use strict';

const PATTERNS = [
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replace: '[email redacted]' },
  { re: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replace: '[phone redacted]' },
  { re: /\bsk-[A-Za-z0-9]{20,}\b/g, replace: '[api_key redacted]' },
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, replace: '[api_key redacted]' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replace: '[aws_key redacted]' },
  { re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replace: '[jwt redacted]' },
];

function redactString(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  PATTERNS.forEach(({ re, replace }) => {
    out = out.replace(re, replace);
  });
  return out;
}

function redactValue(value, depth = 0) {
  if (depth > 6) return '[nested redacted]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
      out[k] = redactValue(v, depth + 1);
    });
    return out;
  }
  return value;
}

function truncatePreview(text, maxLen = 2048) {
  const s = typeof text === 'string' ? text : JSON.stringify(text || '');
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}… [truncated]`;
}

module.exports = { redactString, redactValue, truncatePreview };

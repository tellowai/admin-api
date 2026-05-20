'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');
const Papa = require('papaparse');
const XLSX = require('xlsx');

const PII_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b\+?[1-9]\d{9,14}\b/g,
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
];

function redactPii(text) {
  let out = text;
  PII_PATTERNS.forEach((re) => {
    out = out.replace(re, '[REDACTED]');
  });
  return out;
}

async function parseCsv(buffer) {
  const text = buffer.toString('utf8');
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const rows = (parsed.data || []).slice(0, 50000);
  return redactPii(JSON.stringify(rows.slice(0, 500), null, 2));
}

async function parseXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: false, bookVBA: false });
  const sheet = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' }).slice(0, 500);
  return redactPii(JSON.stringify(rows, null, 2));
}

async function parsePdf(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    if (!data.text || !data.text.trim()) {
      return { text: null, status: 'no_text' };
    }
    return { text: redactPii(data.text.slice(0, 100000)), status: 'completed' };
  } catch (e) {
    if (String(e.message).includes('encrypted')) {
      return { text: null, status: 'failed', error: 'PDF_ENCRYPTED' };
    }
    return { text: null, status: 'failed', error: e.message };
  }
}

async function normalizeImage(buffer, mimeType) {
  let img = sharp(buffer);
  const meta = await img.metadata();
  if (meta.width > 2048 || meta.height > 2048) {
    img = img.resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true });
  }
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    return img.jpeg({ quality: 85 }).toBuffer();
  }
  return img.rotate().jpeg({ quality: 90 }).toBuffer();
}

module.exports = {
  parseCsv,
  parseXlsx,
  parsePdf,
  normalizeImage,
  redactPii,
};

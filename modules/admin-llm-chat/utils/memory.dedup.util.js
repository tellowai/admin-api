'use strict';

const embeddingService = require('../services/memory.embedding.service');

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'our', 'that', 'this', 'with', 'from', 'have', 'has', 'been',
  'should', 'usually', 'when', 'they', 'them', 'into', 'also', 'exist', 'will', 'your',
]);

const TOPIC_KEY_STEMS = /\b(commerce|monetization|monetisation|currency|alacarte|a_la_carte|subscription|sku|focus)\b/i;

const CONTAINMENT_THRESHOLD = 0.82;
const EMBEDDING_DUPLICATE_THRESHOLD = 0.88;

function memoryValue(row) {
  return String(row?.memory_value ?? row?.value ?? '').trim();
}

function memoryKey(row) {
  return String(row?.memory_key ?? row?.key ?? '').trim();
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s₹$€£]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(text) {
  return embeddingService.tokenize(text).filter((t) => !STOPWORDS.has(t) && t.length > 2);
}

function tokenMatches(token, outerTokens) {
  if (outerTokens.includes(token)) return true;
  return outerTokens.some((o) => o.startsWith(token) || token.startsWith(o));
}

function containmentScore(innerText, outerText) {
  const innerTokens = significantTokens(innerText);
  if (innerTokens.length < 1) return 0;
  const outerTokens = significantTokens(outerText);
  if (!outerTokens.length) return 0;
  let hits = 0;
  innerTokens.forEach((t) => {
    if (tokenMatches(t, outerTokens)) hits += 1;
  });
  return hits / innerTokens.length;
}

function sharesTopicKey(keyA, keyB) {
  const a = memoryKey({ key: keyA }).toLowerCase();
  const b = memoryKey({ key: keyB }).toLowerCase();
  if (a === b) return true;
  if (TOPIC_KEY_STEMS.test(a) && TOPIC_KEY_STEMS.test(b)) {
    const stemA = a.replace(/^(primary_|secondary_|core_)/, '');
    const stemB = b.replace(/^(primary_|secondary_|core_)/, '');
    if (stemA === stemB) return true;
    if (stemA.includes(stemB) || stemB.includes(stemA)) return true;
  }
  return false;
}

function embeddingDuplicate(aVec, bVec) {
  if (!aVec?.length || !bVec?.length) return false;
  return embeddingService.cosineSimilarity(aVec, bVec) >= EMBEDDING_DUPLICATE_THRESHOLD;
}

function appearsInOuter(innerVal, outerVal) {
  const normInner = normalizeText(innerVal);
  const normOuter = normalizeText(outerVal);
  if (!normInner || normInner.length < 2) return false;
  if (normOuter.includes(normInner)) return true;

  const digits = String(innerVal).replace(/\D/g, '');
  if (digits.length >= 2 && String(outerVal).includes(digits)) return true;

  return false;
}

/** True when `inner` is mostly covered by a longer `outer` fact. */
function isSubsumedBy(inner, outer) {
  const innerVal = memoryValue(inner);
  const outerVal = memoryValue(outer);
  if (!innerVal || !outerVal) return false;
  if (normalizeText(innerVal) === normalizeText(outerVal)) return true;
  if (innerVal.length >= outerVal.length) return false;
  if (appearsInOuter(innerVal, outerVal)) return true;
  return containmentScore(innerVal, outerVal) >= CONTAINMENT_THRESHOLD;
}

function isRedundantPair(a, b, { aEmbedding = null, bEmbedding = null } = {}) {
  const valA = memoryValue(a);
  const valB = memoryValue(b);
  if (!valA || !valB) return false;

  if (normalizeText(valA) === normalizeText(valB)) return true;
  if (isSubsumedBy(a, b) || isSubsumedBy(b, a)) return true;

  const keyA = memoryKey(a);
  const keyB = memoryKey(b);
  if (sharesTopicKey(keyA, keyB)) {
    const shorter = valA.length <= valB.length ? a : b;
    const longer = valA.length <= valB.length ? b : a;
    if (isSubsumedBy(shorter, longer)) return true;
    const overlap = Math.max(containmentScore(valA, valB), containmentScore(valB, valA));
    if (overlap >= 0.55) return true;
  }

  const textA = `${keyA}: ${valA}`;
  const textB = `${keyB}: ${valB}`;
  const kw = embeddingService.keywordScore(textA, textB);
  if (kw >= 0.55 && (containmentScore(valA, valB) >= 0.65 || containmentScore(valB, valA) >= 0.65)) {
    return true;
  }

  const aEmb = aEmbedding ?? embeddingService.parseEmbeddingJson(a?.embedding_json);
  const bEmb = bEmbedding ?? embeddingService.parseEmbeddingJson(b?.embedding_json);
  if (embeddingDuplicate(aEmb, bEmb)) return true;

  return false;
}

/**
 * Drop incoming facts already covered by existing or sibling batch items.
 * When a new composite fact arrives, mark narrower existing keys for retirement.
 */
function dedupeIncomingMemories(incoming, existing = []) {
  const sorted = [...incoming].sort((a, b) => memoryValue(b).length - memoryValue(a).length);
  const kept = [];
  const retireKeys = [];

  sorted.forEach((item) => {
    const blocked = existing.some((e) => isSubsumedBy(item, e)
      || (isRedundantPair(item, e) && memoryValue(item).length <= memoryValue(e).length))
      || kept.some((k) => isRedundantPair(item, k));
    if (blocked) return;

    existing.forEach((e) => {
      if (isSubsumedBy(e, item)) retireKeys.push(memoryKey(e));
    });
    kept.forEach((k) => {
      if (isSubsumedBy(k, item)) {
        const idx = kept.indexOf(k);
        if (idx >= 0) kept.splice(idx, 1);
      }
    });

    kept.push(item);
  });

  return {
    items: kept,
    retireKeys: [...new Set(retireKeys.filter(Boolean))],
  };
}

module.exports = {
  dedupeIncomingMemories,
  isRedundantPair,
  isSubsumedBy,
  containmentScore,
};

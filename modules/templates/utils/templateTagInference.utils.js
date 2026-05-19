'use strict';

/** niche_slug → default topic tag_code */
const NICHE_TOPIC_TAG = {
  birthday: 'invitation',
  wedding: 'invitation',
  engagement: 'announcement',
  anniversary: 'thank_you',
  baby: 'announcement',
  graduation: 'announcement',
  festival: 'announcement',
  corporate: 'announcement',
  default: 'invitation'
};

/** template_name keywords → style tag_code */
const STYLE_KEYWORD_TAGS = [
  ['pastel', 'pastel'],
  ['floral', 'pastel'],
  ['luxury', 'luxury'],
  ['gold', 'luxury'],
  ['royal', 'luxury'],
  ['vintage', 'vintage_film'],
  ['black and white', 'black_white'],
  ['watercolor', 'watercolor'],
  ['anime', 'anime'],
  ['ghibli', 'ghibli'],
  ['neon', 'neon'],
  ['cinematic', 'cinematic'],
  ['minimal', 'realistic'],
  ['cartoon', 'hand_drawn']
];

const LANGUAGE_CODE_TO_TAG = {
  en: 'english',
  hi: 'hindi',
  te: 'telugu',
  ta: 'tamil',
  kn: 'kannada',
  ml: 'malayalam',
  mr: 'marathi',
  bn: 'bengali',
  gu: 'gujarati',
  pa: 'punjabi'
};

/** tag_code / name signals “matches everything in this facet”. */
const APPLIES_TO_ALL_CODE_RE =
  /^(all|any|generic|universal|not_specific|all_[a-z0-9_]+|[a-z0-9_]+_all)$/i;
const APPLIES_TO_ALL_TEXT_RE =
  /\b(applicable to all|applies to all|all occasions|all styles|all topics|all languages|not specific|any style|any topic)\b/i;

function parseTagAdditionalData(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function isActiveTag(tag) {
  return tag && (tag.is_active === 1 || tag.is_active === true || tag.is_active == null);
}

/**
 * True when this tag means “select every value in the facet” (e.g. All, Generic, Any).
 */
function isAppliesToAllTag(tag) {
  if (!tag) return false;
  const ad = parseTagAdditionalData(tag.additional_data);
  if (ad?.applies_to_all === true) return true;

  const code = String(tag.tag_code || '').trim().toLowerCase();
  const name = String(tag.tag_name || '').trim().toLowerCase();
  const desc = String(tag.tag_description || '').trim().toLowerCase();

  if (APPLIES_TO_ALL_CODE_RE.test(code)) return true;
  if (name === 'all' || name === 'any' || name === 'generic' || name === 'universal') return true;
  if (/^all\s+\w+/.test(name) || /^any\s+\w+/.test(name)) return true;
  if (APPLIES_TO_ALL_TEXT_RE.test(name) || APPLIES_TO_ALL_TEXT_RE.test(desc)) return true;

  return false;
}

function findFacet(facetsWithTags, facetKey) {
  return (facetsWithTags || []).find((f) => f.facet_key === facetKey);
}

function findTagInFacet(facet, { tagCode, tagName, includes }) {
  if (!facet?.tags?.length) return null;
  const code = (tagCode || '').toLowerCase();
  const name = (tagName || '').toLowerCase();
  return facet.tags.find((t) => {
    const tCode = (t.tag_code || '').toLowerCase();
    const tName = (t.tag_name || '').toLowerCase();
    if (code && tCode === code) return true;
    if (name && tName === name) return true;
    if (includes && (tCode.includes(includes) || tName.includes(includes))) return true;
    return false;
  });
}

function toTagRef(facet, tag) {
  if (!facet || !tag) return null;
  return { facet_id: Number(facet.facet_id), ttd_id: Number(tag.ttd_id) };
}

/**
 * Normalize LLM tag output (handles alternate keys and bare ttd_id values).
 */
function normalizeRawTemplateTags(inferred) {
  if (!inferred || typeof inferred !== 'object') return [];
  let raw =
    inferred.template_tag_ids ??
    inferred.template_tags ??
    inferred.tags ??
    [];
  if (!Array.isArray(raw)) raw = [];

  return raw
    .map((item) => {
      if (item == null) return null;
      if (typeof item === 'number' || typeof item === 'string') {
        const ttd_id = Number(item);
        return Number.isFinite(ttd_id) && ttd_id > 0 ? { ttd_id } : null;
      }
      const ttd_id = Number(item.ttd_id ?? item.tag_id ?? item.id);
      const facet_id = item.facet_id != null ? Number(item.facet_id) : undefined;
      if (!Number.isFinite(ttd_id) || ttd_id <= 0) return null;
      return facet_id != null && Number.isFinite(facet_id)
        ? { facet_id, ttd_id }
        : { ttd_id };
    })
    .filter(Boolean);
}

/**
 * Validate against DB; resolve facet_id from ttd_id when LLM sends wrong facet.
 */
function sanitizeInferredTemplateTags(rawTags, facetsWithTags) {
  const tagByTtdId = new Map();
  const facetById = new Map();

  for (const facet of facetsWithTags || []) {
    facetById.set(Number(facet.facet_id), facet);
    for (const tag of facet.tags || []) {
      tagByTtdId.set(Number(tag.ttd_id), {
        facet_id: Number(facet.facet_id),
        ttd_id: Number(tag.ttd_id)
      });
    }
  }

  const byFacet = new Map();
  for (const item of rawTags || []) {
    const ttdId = Number(item?.ttd_id);
    if (!ttdId) continue;
    const canonical = tagByTtdId.get(ttdId);
    if (!canonical) continue;
    const facetId = canonical.facet_id;
    if (!byFacet.has(facetId)) byFacet.set(facetId, []);
    byFacet.get(facetId).push(ttdId);
  }

  let result = [];
  for (const [facetId, ttdIds] of byFacet) {
    const facet = facetById.get(facetId);
    const unique = [...new Set(ttdIds)];
    const limited =
      String(facet?.cardinality || '').toLowerCase() === 'single' ? unique.slice(0, 1) : unique;
    for (const ttd_id of limited) {
      result.push({ facet_id: facetId, ttd_id });
    }
  }

  result = expandAppliesToAllTags(result, facetsWithTags);

  const finalByFacet = new Map();
  for (const item of result) {
    const facet = facetById.get(item.facet_id);
    if (!finalByFacet.has(item.facet_id)) finalByFacet.set(item.facet_id, []);
    finalByFacet.get(item.facet_id).push(item.ttd_id);
  }

  const final = [];
  for (const [facetId, ttdIds] of finalByFacet) {
    const facet = facetById.get(facetId);
    const unique = [...new Set(ttdIds)];
    const limited =
      String(facet?.cardinality || '').toLowerCase() === 'single' ? unique.slice(0, 1) : unique;
    for (const ttd_id of limited) {
      final.push({ facet_id: facetId, ttd_id });
    }
  }
  return final;
}

/**
 * When a facet’s only selection is a generic “all/applicable” tag on a multi facet,
 * expand to every active specific tag in that facet. If specific + generic are mixed,
 * keep specific tags only.
 */
function expandAppliesToAllTags(tags, facetsWithTags) {
  const facetById = new Map();
  for (const facet of facetsWithTags || []) {
    facetById.set(Number(facet.facet_id), facet);
  }

  const byFacet = new Map();
  for (const { facet_id, ttd_id } of tags || []) {
    const facetId = Number(facet_id);
    if (!byFacet.has(facetId)) byFacet.set(facetId, []);
    byFacet.get(facetId).push(Number(ttd_id));
  }

  const expanded = [];
  for (const [facetId, ttdIds] of byFacet) {
    const facet = facetById.get(facetId);
    if (!facet?.tags?.length) continue;

    const tagById = new Map(facet.tags.map((t) => [Number(t.ttd_id), t]));
    const selected = ttdIds.map((id) => tagById.get(id)).filter(Boolean);
    const specific = selected.filter((t) => !isAppliesToAllTag(t));
    const generic = selected.filter((t) => isAppliesToAllTag(t));
    const isMulti = String(facet.cardinality || '').toLowerCase() !== 'single';

    if (specific.length > 0) {
      for (const t of specific) {
        if (isActiveTag(t)) {
          expanded.push({ facet_id: facetId, ttd_id: Number(t.ttd_id) });
        }
      }
      continue;
    }

    if (generic.length > 0 && isMulti) {
      const allSpecific = facet.tags.filter((t) => isActiveTag(t) && !isAppliesToAllTag(t));
      if (allSpecific.length > 0) {
        for (const t of allSpecific) {
          expanded.push({ facet_id: facetId, ttd_id: Number(t.ttd_id) });
        }
      } else {
        for (const t of facet.tags.filter(isActiveTag)) {
          expanded.push({ facet_id: facetId, ttd_id: Number(t.ttd_id) });
        }
      }
      continue;
    }

    for (const t of selected) {
      if (isActiveTag(t)) {
        expanded.push({ facet_id: facetId, ttd_id: Number(t.ttd_id) });
      }
    }
  }

  return expanded;
}

/**
 * Rule-based tags from inferred metadata when LLM returns none / too few.
 */
function inferTemplateTagsHeuristic(inferred, facetsWithTags) {
  const tags = [];
  const name = String(inferred?.template_name || '').toLowerCase();
  const niche = String(inferred?.niche_slug || '').toLowerCase();
  const lang = String(inferred?.language_code || 'en').toLowerCase().split('-')[0];

  const topicFacet = findFacet(facetsWithTags, 'topic');
  const topicCode = NICHE_TOPIC_TAG[niche] || NICHE_TOPIC_TAG.default;
  let topicTag = findTagInFacet(topicFacet, { tagCode: topicCode });
  if (!topicTag && niche) {
    topicTag = findTagInFacet(topicFacet, { includes: niche });
  }
  if (!topicTag) {
    topicTag = findTagInFacet(topicFacet, { tagCode: 'invitation' });
  }
  const topicRef = toTagRef(topicFacet, topicTag);
  if (topicRef) tags.push(topicRef);

  const styleFacet = findFacet(facetsWithTags, 'style');
  let styleTag = null;
  for (const [keyword, code] of STYLE_KEYWORD_TAGS) {
    if (name.includes(keyword)) {
      styleTag = findTagInFacet(styleFacet, { tagCode: code });
      if (styleTag) break;
    }
  }
  if (!styleTag) {
    styleTag = findTagInFacet(styleFacet, { tagCode: 'realistic' }) || styleFacet?.tags?.[0];
  }
  const styleRef = toTagRef(styleFacet, styleTag);
  if (styleRef) tags.push(styleRef);

  const langFacet = findFacet(facetsWithTags, 'language_script');
  const langCode = LANGUAGE_CODE_TO_TAG[lang] || lang;
  let langTag =
    findTagInFacet(langFacet, { tagCode: langCode }) ||
    findTagInFacet(langFacet, { includes: langCode });
  if (!langTag) {
    langTag = findTagInFacet(langFacet, { tagCode: 'english' });
  }
  const langRef = toTagRef(langFacet, langTag);
  if (langRef) tags.push(langRef);

  const occasionFacet = findFacet(facetsWithTags, 'occasion');
  const occasionHints = {
    wedding: 'pre_wedding',
    engagement: 'engagement',
    anniversary: 'anniversary'
  };
  if (occasionHints[niche]) {
    const occasionTag = findTagInFacet(occasionFacet, { tagCode: occasionHints[niche] });
    const occasionRef = toTagRef(occasionFacet, occasionTag);
    if (occasionRef) tags.push(occasionRef);
  }

  return sanitizeInferredTemplateTags(tags, facetsWithTags);
}

/**
 * Merge LLM tags with heuristic fill for required facets still empty.
 */
function resolveTemplateTags(inferred, facetsWithTags) {
  const raw = normalizeRawTemplateTags(inferred);
  let tags = sanitizeInferredTemplateTags(raw, facetsWithTags);

  const facetsWithAssignment = new Set(tags.map((t) => t.facet_id));
  const requiredFacets = (facetsWithTags || []).filter((f) => f.required_for_publish);
  const missingRequired = requiredFacets.some(
    (f) => !facetsWithAssignment.has(Number(f.facet_id))
  );

  if (!tags.length || missingRequired) {
    const heuristic = inferTemplateTagsHeuristic(inferred, facetsWithTags);
    const merged = [...tags];
    const assignedFacets = new Set(merged.map((t) => t.facet_id));
    for (const tag of heuristic) {
      if (!assignedFacets.has(tag.facet_id)) {
        merged.push(tag);
        assignedFacets.add(tag.facet_id);
      }
    }
    tags = sanitizeInferredTemplateTags(merged, facetsWithTags);
  }

  return tags;
}

function buildTemplateTagLabels(templateTagIds, facetsWithTags) {
  return (templateTagIds || [])
    .map(({ facet_id, ttd_id }) => {
      const facet = (facetsWithTags || []).find((f) => Number(f.facet_id) === Number(facet_id));
      const tag = facet?.tags?.find((t) => Number(t.ttd_id) === Number(ttd_id));
      if (!facet || !tag) return null;
      const facetLabel = facet.facet_display_name || facet.facet_name || facet.facet_key;
      return `${facetLabel}: ${tag.tag_name}`;
    })
    .filter(Boolean);
}

function enrichFacetsCatalogForLlm(facetsWithTags) {
  return (facetsWithTags || [])
    .filter((f) => f.visible !== false && f.visible !== 0)
    .map((facet) => ({
      facet_id: facet.facet_id,
      facet_key: facet.facet_key,
      display_name: facet.facet_display_name || facet.facet_name,
      cardinality: facet.cardinality || 'single',
      required_for_publish: !!facet.required_for_publish,
      tags: (facet.tags || []).map((tag) => ({
        ttd_id: tag.ttd_id,
        tag_name: tag.tag_name,
        tag_code: tag.tag_code,
        applies_to_all: isAppliesToAllTag(tag)
      }))
    }));
}

module.exports = {
  normalizeRawTemplateTags,
  sanitizeInferredTemplateTags,
  inferTemplateTagsHeuristic,
  resolveTemplateTags,
  buildTemplateTagLabels,
  enrichFacetsCatalogForLlm,
  isAppliesToAllTag,
  expandAppliesToAllTags
};

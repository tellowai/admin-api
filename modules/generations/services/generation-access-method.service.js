'use strict';

const SUBSCRIPTION_TIER_PLAN_TYPES = new Set([
  'premium_single',
  'premium_bundle',
  'unified_bundle',
  'unified_pack'
]);

/**
 * Template-scoped single purchase (à la carte) — stored as premium_single + template_id, or unified_single.
 * @param {{ tier_plan_type?: string, template_id?: string|null }} entitlement
 * @returns {boolean}
 */
function isAlacarteEntitlementRow(entitlement) {
  if (!entitlement) return false;
  const tier = entitlement.tier_plan_type != null ? String(entitlement.tier_plan_type).trim() : '';
  if (tier === 'unified_single') return true;
  const entTemplateId =
    entitlement.template_id != null && String(entitlement.template_id).trim() !== ''
      ? String(entitlement.template_id).trim()
      : '';
  if (!entTemplateId) return false;
  return tier === 'premium_single';
}

/** Subscription pool / bundle entitlement (not template-scoped à la carte). */
function isSubscriptionEntitlementRow(entitlement) {
  if (!entitlement || isAlacarteEntitlementRow(entitlement)) return false;
  const tier = entitlement.tier_plan_type != null ? String(entitlement.tier_plan_type).trim() : '';
  return !!(tier && SUBSCRIPTION_TIER_PLAN_TYPES.has(tier));
}

function hasClaimedTemplateSlotOnGeneration(gen) {
  const raw = gen?.claimed_template_id ?? gen?.mg_claimed_template_id;
  if (raw == null) return false;
  const s = String(raw).trim();
  return s !== '' && s !== '0' && s !== 'null';
}

function isPaidTemplateMeta(templateMeta = {}) {
  const templateType =
    templateMeta.templateType != null ? String(templateMeta.templateType).trim().toLowerCase() : '';
  const credits = Number(templateMeta.credits);
  if (templateType === 'free') return false;
  if (Number.isFinite(credits)) return credits > 0;
  return templateType !== '';
}

function hasExplicitEntitlementOnGeneration(gen) {
  const explicit = gen.mg_entitlement_id ?? gen.claim_entitlement_id;
  if (explicit == null) return false;
  const s = String(explicit).trim();
  return s !== '' && s !== 'null' && Number.isFinite(Number(explicit)) && Number(explicit) > 0;
}

/** Free-tier uses claimed_templates with entitlement_id IS NULL (not linked to subscription pool). */
function isFreeTierClaimOnGeneration(gen) {
  if (!hasClaimedTemplateSlotOnGeneration(gen)) return false;
  const claimEnt = gen.claim_entitlement_id;
  return claimEnt == null || String(claimEnt).trim() === '' || String(claimEnt) === 'null';
}

/**
 * ALLOWED_FREE on a paid template: no credits, no entitlement on media_generations, no subscription claim link.
 */
function isFreeTierPaidTemplateGeneration(gen, creditUsageIds, templateMeta) {
  if (!isPaidTemplateMeta(templateMeta)) return false;
  const genId = gen.media_generation_id != null ? String(gen.media_generation_id) : '';
  if (genId && creditUsageIds instanceof Set && creditUsageIds.has(genId)) return false;
  if (hasExplicitEntitlementOnGeneration(gen)) return false;
  if (hasClaimedTemplateSlotOnGeneration(gen)) return false;
  return true;
}

function getChEntitlementIdForGeneration(gen, chEntitlementByMediaId) {
  const genId = gen?.media_generation_id != null ? String(gen.media_generation_id) : '';
  if (!genId || !(chEntitlementByMediaId instanceof Map)) return null;
  const chEid = chEntitlementByMediaId.get(genId);
  if (chEid == null || !Number.isFinite(Number(chEid)) || Number(chEid) <= 0) return null;
  return Number(chEid);
}

function resolveEntitlementForAnalytics(gen, bucketEntitlementId, entitlementMap, chEntitlementByMediaId) {
  const candidates = [gen.mg_entitlement_id, gen.claim_entitlement_id];
  for (const raw of candidates) {
    if (raw == null || String(raw).trim() === '' || String(raw) === 'null') continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && entitlementMap[n]) {
      return entitlementMap[n];
    }
  }
  const chEid = getChEntitlementIdForGeneration(gen, chEntitlementByMediaId);
  if (chEid != null && entitlementMap[chEid]) {
    return entitlementMap[chEid];
  }
  if (bucketEntitlementId != null && String(bucketEntitlementId).trim() !== '' && String(bucketEntitlementId) !== 'null') {
    const n = Number(bucketEntitlementId);
    if (Number.isFinite(n) && n > 0 && entitlementMap[n]) {
      return entitlementMap[n];
    }
  }
  return null;
}

/**
 * Map entitlement + template context to admin generation access labels.
 * @param {{ entitlement?: { tier_plan_type?: string, template_id?: string|null }|null, templateType?: string|null, credits?: number|null }} input
 * @returns {{ generation_access_method: string, generation_access_label: string, tier_plan_type?: string|null }}
 */
function mapGenerationAccessMethod(input = {}) {
  const entitlement = input.entitlement || null;
  const tier = entitlement?.tier_plan_type != null ? String(entitlement.tier_plan_type).trim() : '';

  if (isAlacarteEntitlementRow(entitlement)) {
    return {
      generation_access_method: 'alacarte',
      generation_access_label: 'À la carte',
      tier_plan_type: tier
    };
  }

  if (tier && SUBSCRIPTION_TIER_PLAN_TYPES.has(tier)) {
    return {
      generation_access_method: 'subscription',
      generation_access_label: 'Subscription',
      tier_plan_type: tier
    };
  }

  const templateType = input.templateType != null ? String(input.templateType).trim().toLowerCase() : '';
  const credits = Number(input.credits);
  const isPaidTemplate = templateType !== 'free' && (Number.isFinite(credits) ? credits > 0 : templateType !== '');

  if (!entitlement) {
    if (templateType === 'free' || (!isPaidTemplate && credits <= 0)) {
      return {
        generation_access_method: 'free',
        generation_access_label: 'Free',
        tier_plan_type: null
      };
    }
    if (isPaidTemplate) {
      return {
        generation_access_method: 'subscription_credits',
        generation_access_label: 'Subscription (credits)',
        tier_plan_type: null
      };
    }
  }

  return {
    generation_access_method: 'unknown',
    generation_access_label: 'Unknown',
    tier_plan_type: tier || null
  };
}

/** Display order when counts tie (analytics user rows). */
const ACCESS_METHOD_SORT_ORDER = [
  'alacarte',
  'subscription',
  'subscription_credits',
  'free',
  'unknown'
];

/**
 * Access-method pills with generation counts per method (sums bucket cnt per user).
 * @param {Array<{ entitlement_id?: string|number|null, cnt?: number }>} buckets
 * @param {Record<number, { tier_plan_type?: string }>} entitlementMap
 * @param {{ templateType?: string, credits?: number }} templateMeta
 * @returns {Array<{ method: string, label: string, count: number }>}
 */
function collectAccessMethodsFromBuckets(buckets, entitlementMap, templateMeta = {}) {
  const byMethod = new Map();
  const list = Array.isArray(buckets) ? buckets : [];

  for (const b of list) {
    const bucketCnt = Math.max(0, Number(b.cnt) || 0);
    if (bucketCnt <= 0) continue;

    const eidRaw = b.entitlement_id;
    const eid =
      eidRaw != null && String(eidRaw).trim() !== '' && String(eidRaw) !== 'null'
        ? Number(eidRaw)
        : null;
    const ent =
      eid != null && Number.isFinite(eid) && entitlementMap[eid] ? entitlementMap[eid] : null;
    const access = mapGenerationAccessMethod({
      entitlement: ent,
      templateType: templateMeta.templateType,
      credits: templateMeta.credits
    });
    const method = access.generation_access_method;
    const existing = byMethod.get(method);
    if (existing) {
      existing.count += bucketCnt;
    } else {
      byMethod.set(method, {
        method,
        label: access.generation_access_label,
        count: bucketCnt
      });
    }
  }

  return [...byMethod.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const ai = ACCESS_METHOD_SORT_ORDER.indexOf(a.method);
    const bi = ACCESS_METHOD_SORT_ORDER.indexOf(b.method);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

/**
 * Template analytics: only À la carte + Subscription pills.
 * Wallet credit generations (subscription_credits) roll into Subscription.
 * @returns {Array<{ method: 'alacarte'|'subscription', label: string, count: number }>}
 */
/**
 * Resolve entitlement per generation for one user (batch — handles missing DB fields).
 * @param {Array<{ mg_entitlement_id?: *, claim_entitlement_id?: *, activity_at?: * }>} generationRows
 * @param {Array} userEntitlements
 * @returns {Array<{ entitlement_id: number|null, cnt: number }>}
 */
function toCreditDeductionSet(creditDeductionIds) {
  if (creditDeductionIds instanceof Set) return creditDeductionIds;
  return new Set((creditDeductionIds || []).map((id) => String(id).trim()).filter(Boolean));
}

/**
 * Template analytics access:
 * 1. Paid + credit reserve/deduction → Subscription
 * 2. À la carte entitlement → À la carte
 * 3. claimed_template with NULL entitlement (free-tier claim row) → Free
 * 4. claimed_template with subscription entitlement → Subscription
 * 5. Paid ALLOWED_FREE signature (no credits/claim/entitlement on row) → Free
 * 6. Resolved subscription entitlement (row, bucket, or CH) → Subscription
 * 7. Else → Free
 */
function mapTemplateAnalyticsAccessMethod({
  hasCreditSubscriptionUsage = false,
  entitlement = null,
  gen = null,
  creditUsageIds = new Set(),
  templateMeta = {}
} = {}) {
  // Classify from per-generation signals (credits, entitlements, claims), not the template's
  // current type — a template switched to free still has historical credit/à la carte rows.

  if (hasCreditSubscriptionUsage) {
    return {
      generation_access_method: 'subscription',
      generation_access_label: 'Subscription'
    };
  }
  if (isAlacarteEntitlementRow(entitlement)) {
    return {
      generation_access_method: 'alacarte',
      generation_access_label: 'À la carte'
    };
  }
  if (gen && isFreeTierClaimOnGeneration(gen)) {
    return {
      generation_access_method: 'free',
      generation_access_label: 'Free'
    };
  }
  if (gen && hasClaimedTemplateSlotOnGeneration(gen)) {
    return {
      generation_access_method: 'subscription',
      generation_access_label: 'Subscription'
    };
  }
  if (isSubscriptionEntitlementRow(entitlement)) {
    return {
      generation_access_method: 'subscription',
      generation_access_label: 'Subscription'
    };
  }
  if (gen && isFreeTierPaidTemplateGeneration(gen, creditUsageIds, templateMeta)) {
    return {
      generation_access_method: 'free',
      generation_access_label: 'Free'
    };
  }
  return {
    generation_access_method: 'free',
    generation_access_label: 'Free'
  };
}

function resolveEntitlementBucketsForUser(generationRows, userEntitlements = []) {
  const sorted = [...(generationRows || [])].sort(
    (a, b) => new Date(a.activity_at).getTime() - new Date(b.activity_at).getTime()
  );
  const ents = Array.isArray(userEntitlements) ? userEntitlements : [];
  const subEnt = ents.find((e) => isSubscriptionEntitlementRow(e));
  const alacarteEnts = ents
    .filter((e) => isAlacarteEntitlementRow(e))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const buckets = [];

  for (const gen of sorted) {
    const explicit = gen.mg_entitlement_id ?? gen.claim_entitlement_id;
    if (explicit != null && String(explicit).trim() !== '' && String(explicit) !== 'null') {
      const n = Number(explicit);
      if (Number.isFinite(n) && n > 0) {
        buckets.push({ entitlement_id: n, cnt: 1 });
        continue;
      }
    }

    const activityMs = new Date(gen.activity_at).getTime();
    if (!Number.isFinite(activityMs)) {
      buckets.push({
        entitlement_id: subEnt?.entitlement_id != null ? Number(subEnt.entitlement_id) : null,
        cnt: 1
      });
      continue;
    }

    const alacarteBeforeGen = alacarteEnts
      .filter((e) => e.created_at && new Date(e.created_at).getTime() <= activityMs)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const latestAlacarte = alacarteBeforeGen[0];
    const purchaseMs = latestAlacarte?.created_at
      ? new Date(latestAlacarte.created_at).getTime()
      : Infinity;

    if (!latestAlacarte || activityMs < purchaseMs) {
      buckets.push({
        entitlement_id: subEnt?.entitlement_id != null ? Number(subEnt.entitlement_id) : null,
        cnt: 1
      });
      continue;
    }

    const slotCount = 1;

    const priorAfterPurchase = sorted.filter((g) => {
      const t = new Date(g.activity_at).getTime();
      return Number.isFinite(t) && t >= purchaseMs && t < activityMs;
    }).length;

    if (priorAfterPurchase < slotCount) {
      buckets.push({ entitlement_id: Number(latestAlacarte.entitlement_id), cnt: 1 });
    } else {
      buckets.push({
        entitlement_id: subEnt?.entitlement_id != null ? Number(subEnt.entitlement_id) : null,
        cnt: 1
      });
    }
  }

  return buckets;
}

const TEMPLATE_ANALYTICS_ACCESS_LABELS = {
  alacarte: 'À la carte',
  subscription: 'Subscription',
  free: 'Free'
};

const TEMPLATE_ANALYTICS_METHOD_SORT = { alacarte: 0, subscription: 1, free: 2 };

function aggregateTemplateAnalyticsFromTimelineItems(timelineItems) {
  const rolled = new Map();
  for (const item of timelineItems || []) {
    const method = item.access_method;
    if (!method || !TEMPLATE_ANALYTICS_ACCESS_LABELS[method]) continue;
    const label = TEMPLATE_ANALYTICS_ACCESS_LABELS[method];
    const existing = rolled.get(method);
    if (existing) {
      existing.count += 1;
    } else {
      rolled.set(method, { method, label, count: 1 });
    }
  }
  return [...rolled.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const ai = TEMPLATE_ANALYTICS_METHOD_SORT[a.method] ?? 99;
    const bi = TEMPLATE_ANALYTICS_METHOD_SORT[b.method] ?? 99;
    return ai - bi;
  });
}

function buildAccessMethodsByUserFromGenerations(
  generationRows,
  entitlementsByUserId,
  templateMeta = {},
  analyticsContext = {}
) {
  const rowsByUser = new Map();
  for (const gen of generationRows || []) {
    const uid = gen.user_id != null ? String(gen.user_id).trim() : '';
    if (!uid) continue;
    if (!rowsByUser.has(uid)) rowsByUser.set(uid, []);
    rowsByUser.get(uid).push(gen);
  }

  const out = new Map();
  for (const [uid, userRows] of rowsByUser) {
    const userEntitlements = entitlementsByUserId[uid] || [];
    const items = buildTemplateUserGenerationTimelineItems(
      userRows,
      userEntitlements,
      templateMeta,
      analyticsContext
    );
    out.set(uid, aggregateTemplateAnalyticsFromTimelineItems(items));
  }
  return out;
}

/**
 * One timeline row per generation with Subscription / À la carte access (analytics UI).
 * @returns {Array<{ media_generation_id: string, activity_at: *, job_status: string, access_method: string|null, access_label: string|null }>}
 */
function buildTemplateUserGenerationTimelineItems(
  generationRows,
  userEntitlements,
  templateMeta = {},
  analyticsContext = {}
) {
  const {
    creditUsageIds = new Set(),
    chEntitlementByMediaId = new Map(),
    entitlementMap: contextEntitlementMap = null
  } = analyticsContext;
  const creditSet = toCreditDeductionSet(creditUsageIds);
  const sorted = [...(generationRows || [])].sort(
    (a, b) => new Date(a.activity_at).getTime() - new Date(b.activity_at).getTime()
  );
  const buckets = resolveEntitlementBucketsForUser(sorted, userEntitlements);
  const entitlementMap = contextEntitlementMap || {};
  if (!contextEntitlementMap) {
    for (const e of userEntitlements || []) {
      if (e.entitlement_id != null) entitlementMap[e.entitlement_id] = e;
    }
  }

  return sorted.map((gen, i) => {
    const bucket = buckets[i] || {};
    const bucketEid = bucket.entitlement_id;
    const ent = resolveEntitlementForAnalytics(gen, bucketEid, entitlementMap, chEntitlementByMediaId);
    const genId = gen.media_generation_id != null ? String(gen.media_generation_id) : '';
    const access = mapTemplateAnalyticsAccessMethod({
      hasCreditSubscriptionUsage: genId ? creditSet.has(genId) : false,
      entitlement: ent,
      gen,
      creditUsageIds: creditSet,
      templateMeta
    });
    let method = access.generation_access_method;
    let label = access.generation_access_label;
    if (!TEMPLATE_ANALYTICS_ACCESS_LABELS[method]) {
      method = 'free';
      label = 'Free';
    }
    return {
      media_generation_id: gen.media_generation_id,
      activity_at: gen.activity_at,
      job_status: gen.job_status,
      access_method: method,
      access_label: label
    };
  });
}

/**
 * Overlay per-generation Subscription / À la carte on list rows (template-scoped analytics).
 * Uses MySQL access rows + entitlement history (same logic as template user summary).
 */
function applyTemplateAnalyticsAccessToGenerations(
  generations,
  accessGenerationRows,
  templateMeta = {},
  analyticsContext = {}
) {
  const list = Array.isArray(generations) ? generations : [];
  if (!list.length) return;

  const {
    entitlementsByUserId = {},
    claimsByUserId = {},
    chEntitlementByMediaId = new Map(),
    creditUsageIds = new Set(),
    entitlementMap = {}
  } = analyticsContext;

  const accessRows = Array.isArray(accessGenerationRows) ? accessGenerationRows : [];
  const rowByMediaId = new Map();
  for (const row of accessRows) {
    const id = row.media_generation_id != null ? String(row.media_generation_id) : '';
    if (id) rowByMediaId.set(id, row);
  }

  const rowsByUser = new Map();
  for (const gen of list) {
    const id = gen.media_generation_id != null ? String(gen.media_generation_id) : '';
    const uid = gen.user_id != null ? String(gen.user_id).trim() : '';
    if (!id || !uid) continue;
    const row = rowByMediaId.get(id) || {
      media_generation_id: id,
      user_id: uid,
      mg_entitlement_id: gen.entitlement_id ?? null,
      claim_entitlement_id: null,
      claimed_template_id: null,
      activity_at: gen.created_at || gen.completed_at
    };
    if (!rowsByUser.has(uid)) rowsByUser.set(uid, []);
    rowsByUser.get(uid).push(row);
  }

  const accessByMediaId = new Map();
  for (const [uid, userRows] of rowsByUser) {
    const items = buildTemplateUserGenerationTimelineItems(
      userRows,
      entitlementsByUserId[uid] || [],
      templateMeta,
      {
        creditUsageIds,
        chEntitlementByMediaId,
        claimsByUserId,
        entitlementMap
      }
    );
    for (const item of items) {
      if (!item.media_generation_id) continue;
      accessByMediaId.set(String(item.media_generation_id), {
        generation_access_method: item.access_method || null,
        generation_access_label: item.access_label || null
      });
    }
  }

  for (const gen of list) {
    const id = gen.media_generation_id != null ? String(gen.media_generation_id) : '';
    if (!id || !accessByMediaId.has(id)) continue;
    const overlay = accessByMediaId.get(id);
    gen.generation_access_method = overlay.generation_access_method;
    gen.generation_access_label = overlay.generation_access_label;
  }
}

function collectTemplateAnalyticsAccessMethods(buckets, entitlementMap, templateMeta = {}) {
  const raw = collectAccessMethodsFromBuckets(buckets, entitlementMap, templateMeta);
  const rolled = new Map();

  for (const item of raw) {
    let method = item.method;
    if (method === 'subscription_credits') {
      method = 'subscription';
    }
    if (!TEMPLATE_ANALYTICS_ACCESS_LABELS[method]) continue;

    const label = TEMPLATE_ANALYTICS_ACCESS_LABELS[method];
    const existing = rolled.get(method);
    if (existing) {
      existing.count += item.count;
    } else {
      rolled.set(method, { method, label, count: item.count });
    }
  }

  return [...rolled.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const ai = TEMPLATE_ANALYTICS_METHOD_SORT[a.method] ?? 99;
    const bi = TEMPLATE_ANALYTICS_METHOD_SORT[b.method] ?? 99;
    return ai - bi;
  });
}

module.exports = {
  mapGenerationAccessMethod,
  mapTemplateAnalyticsAccessMethod,
  collectAccessMethodsFromBuckets,
  collectTemplateAnalyticsAccessMethods,
  buildTemplateUserGenerationTimelineItems,
  applyTemplateAnalyticsAccessToGenerations,
  resolveEntitlementBucketsForUser,
  buildAccessMethodsByUserFromGenerations,
  isAlacarteEntitlementRow,
  isSubscriptionEntitlementRow,
  SUBSCRIPTION_TIER_PLAN_TYPES
};

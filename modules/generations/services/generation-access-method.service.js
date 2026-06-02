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
function resolveEntitlementBucketsForUser(generationRows, userEntitlements = []) {
  const sorted = [...(generationRows || [])].sort(
    (a, b) => new Date(a.activity_at).getTime() - new Date(b.activity_at).getTime()
  );
  const ents = Array.isArray(userEntitlements) ? userEntitlements : [];
  const subEnt = ents.find((e) => !isAlacarteEntitlementRow(e));
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
      buckets.push({ entitlement_id: null, cnt: 1 });
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

function buildAccessMethodsByUserFromGenerations(generationRows, entitlementsByUserId, templateMeta = {}) {
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
    const buckets = resolveEntitlementBucketsForUser(userRows, userEntitlements);
    const entitlementMap = {};
    for (const e of userEntitlements) {
      if (e.entitlement_id != null) entitlementMap[e.entitlement_id] = e;
    }
    out.set(uid, collectTemplateAnalyticsAccessMethods(buckets, entitlementMap, templateMeta));
  }
  return out;
}

/**
 * One timeline row per generation with Subscription / À la carte access (analytics UI).
 * @returns {Array<{ media_generation_id: string, activity_at: *, job_status: string, access_method: string|null, access_label: string|null }>}
 */
function buildTemplateUserGenerationTimelineItems(generationRows, userEntitlements, templateMeta = {}) {
  const sorted = [...(generationRows || [])].sort(
    (a, b) => new Date(a.activity_at).getTime() - new Date(b.activity_at).getTime()
  );
  const buckets = resolveEntitlementBucketsForUser(sorted, userEntitlements);
  const entitlementMap = {};
  for (const e of userEntitlements || []) {
    if (e.entitlement_id != null) entitlementMap[e.entitlement_id] = e;
  }

  return sorted.map((gen, i) => {
    const bucket = buckets[i] || {};
    const eidRaw = bucket.entitlement_id;
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
    let method = access.generation_access_method;
    let label = access.generation_access_label;
    if (method === 'subscription_credits') {
      method = 'subscription';
      label = 'Subscription';
    }
    if (method !== 'alacarte' && method !== 'subscription') {
      method = null;
      label = null;
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
  userEntitlementRows,
  templateMeta = {}
) {
  const list = Array.isArray(generations) ? generations : [];
  const accessRows = Array.isArray(accessGenerationRows) ? accessGenerationRows : [];
  if (!list.length || !accessRows.length) return;

  const entsByUserId = {};
  for (const e of userEntitlementRows || []) {
    const uid = e.user_id != null ? String(e.user_id).trim() : '';
    if (!uid) continue;
    if (!entsByUserId[uid]) entsByUserId[uid] = [];
    entsByUserId[uid].push(e);
  }

  const rowsByUser = new Map();
  for (const row of accessRows) {
    const uid = row.user_id != null ? String(row.user_id).trim() : '';
    if (!uid) continue;
    if (!rowsByUser.has(uid)) rowsByUser.set(uid, []);
    rowsByUser.get(uid).push(row);
  }

  const accessByMediaId = new Map();
  for (const [uid, userRows] of rowsByUser) {
    const items = buildTemplateUserGenerationTimelineItems(
      userRows,
      entsByUserId[uid] || [],
      templateMeta
    );
    for (const item of items) {
      if (!item.access_method || !item.media_generation_id) continue;
      accessByMediaId.set(String(item.media_generation_id), {
        generation_access_method: item.access_method,
        generation_access_label: item.access_label
      });
    }
  }

  for (const gen of list) {
    const id = gen.media_generation_id != null ? String(gen.media_generation_id) : '';
    const overlay = id ? accessByMediaId.get(id) : null;
    if (overlay) {
      gen.generation_access_method = overlay.generation_access_method;
      gen.generation_access_label = overlay.generation_access_label;
    }
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
    if (method !== 'alacarte' && method !== 'subscription') continue;

    const label = method === 'alacarte' ? 'À la carte' : 'Subscription';
    const existing = rolled.get(method);
    if (existing) {
      existing.count += item.count;
    } else {
      rolled.set(method, { method, label, count: item.count });
    }
  }

  return [...rolled.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.method === 'alacarte' ? -1 : 1;
  });
}

module.exports = {
  mapGenerationAccessMethod,
  collectAccessMethodsFromBuckets,
  collectTemplateAnalyticsAccessMethods,
  buildTemplateUserGenerationTimelineItems,
  applyTemplateAnalyticsAccessToGenerations,
  resolveEntitlementBucketsForUser,
  buildAccessMethodsByUserFromGenerations,
  isAlacarteEntitlementRow,
  SUBSCRIPTION_TIER_PLAN_TYPES
};

'use strict';

const ACTIVE_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'renewed',
  'pending',
  'trial',
  'paused',
  'upgraded',
  'active_non_recurring',
  'upgraded_non_recurring',
  'pending_otp_verification_for_upgrade'
]);

function parseSubscriptionAdditionalData(raw) {
  if (raw == null || raw === '') return null;
  if (Buffer.isBuffer(raw)) {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function subscriptionPeriodEndMs(row) {
  const end = row.current_period_end || row.renews_at || row.end_at;
  if (!end) return null;
  const t = new Date(end).getTime();
  return Number.isNaN(t) ? null : t;
}

function subscriptionPeriodStartMs(row) {
  const start = row.purchase_or_start_at || row.start_at || row.created_at;
  if (!start) return null;
  const t = new Date(start).getTime();
  return Number.isNaN(t) ? null : t;
}

function additionalDataIndicatesCancellation(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.cancellation_metadata) return true;

  const source =
    data.cancellation_source != null ? String(data.cancellation_source).trim().toLowerCase() : '';
  if (source === 'webhook' || source === 'api') return true;

  if (String(data.status || '').trim().toLowerCase() === 'cancelled') return true;

  const providerStatus = data.provider_response?.status;
  if (providerStatus != null && String(providerStatus).trim().toLowerCase() === 'cancelled') {
    return true;
  }

  const notes = data.notes;
  if (notes && typeof notes === 'object') {
    if (notes.cancelled_at != null && String(notes.cancelled_at).trim() !== '') return true;
    if (notes.cancellation_source != null && String(notes.cancellation_source).trim() !== '') {
      return true;
    }
  }

  return false;
}

/** Rows replaced by a later renewal/resubscribe billing period. */
function buildSupersededByRenewalSet(rawRows) {
  const superseded = new Set();
  for (const r of rawRows || []) {
    const data = parseSubscriptionAdditionalData(
      r.subscription_additional_data != null ? r.subscription_additional_data : r.additional_data
    );
    const prev = data?.previous_subscription_id;
    if (prev != null && String(prev).trim() !== '') {
      superseded.add(String(prev).trim());
    }
  }
  return superseded;
}

function subscriptionPurchaserKey(row) {
  if (row.user_id != null && String(row.user_id).trim() !== '') {
    return `user:${String(row.user_id).trim()}`;
  }
  if (row.device_id != null && String(row.device_id).trim() !== '') {
    return `device:${String(row.device_id).trim()}`;
  }
  return '';
}

function subscriptionStoreKey(row) {
  const purchaser = subscriptionPurchaserKey(row);
  const providerId =
    row.provider_subscription_id != null && String(row.provider_subscription_id).trim() !== ''
      ? String(row.provider_subscription_id).trim()
      : null;
  if (providerId) return `${purchaser}::${providerId}`;
  const planId =
    row.provider_plan_id != null && String(row.provider_plan_id).trim() !== ''
      ? String(row.provider_plan_id).trim()
      : 'unknown';
  return `${purchaser}::plan:${planId}`;
}

function rowHasCancellationSignals(row, webhookCancelledIds, webhookCancelledProviderIds) {
  if (!row) return false;
  const sid = String(row.subscription_id);
  if (webhookCancelledIds.has(sid)) return true;

  const providerId =
    row.provider_subscription_id != null ? String(row.provider_subscription_id).trim() : '';
  if (providerId && webhookCancelledProviderIds.has(providerId)) return true;

  const status = row.status != null ? String(row.status).toLowerCase().trim() : '';
  if (status === 'cancelled') return true;
  if (row.cancelled_at != null && String(row.cancelled_at).trim() !== '') return true;

  const data = parseSubscriptionAdditionalData(
    row.subscription_additional_data != null ? row.subscription_additional_data : row.additional_data
  );
  return additionalDataIndicatesCancellation(data);
}

/**
 * Per store-transaction group: only the latest billing-period row may show cancelled.
 * Older renewal / initial rows always show expired.
 */
function buildSubscriptionGroupDisplayContext(
  rawRows,
  webhookCancelledIds = new Set(),
  webhookCancelledProviderIds = new Set()
) {
  const supersededIds = buildSupersededByRenewalSet(rawRows);
  const groups = new Map();

  for (const row of rawRows || []) {
    const key = subscriptionStoreKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const headIds = new Set();
  const groupCancelled = new Map();

  for (const [key, rows] of groups) {
    const sorted = [...rows].sort((a, b) => {
      const aMs = subscriptionPeriodStartMs(a) ?? 0;
      const bMs = subscriptionPeriodStartMs(b) ?? 0;
      if (bMs !== aMs) return bMs - aMs;
      return String(b.subscription_id).localeCompare(String(a.subscription_id));
    });

    const head = sorted.find((r) => !supersededIds.has(String(r.subscription_id))) || sorted[0];
    if (head) headIds.add(String(head.subscription_id));

    const cancelled = rows.some((r) =>
      rowHasCancellationSignals(r, webhookCancelledIds, webhookCancelledProviderIds)
    );
    groupCancelled.set(key, cancelled);
  }

  return { supersededIds, headIds, groupCancelled, subscriptionStoreKey };
}

function subscriptionRowIsCancelled(row) {
  if (!row) return false;
  if (row._webhook_cancel_confirmed === true || row._webhook_cancel_confirmed === 1) return true;
  if (row._superseded_by_renewal === 1 || row._superseded_by_renewal === true) return false;

  const status = row.status != null ? String(row.status).toLowerCase().trim() : '';
  if (status === 'cancelled') return true;
  if (row.cancelled_at != null && String(row.cancelled_at).trim() !== '') return true;

  const data = parseSubscriptionAdditionalData(
    row.subscription_additional_data != null ? row.subscription_additional_data : row.additional_data
  );
  return additionalDataIndicatesCancellation(data);
}

function displaySubscriptionStatus(row) {
  if (subscriptionRowIsCancelled(row)) return 'cancelled';

  const status = row.status != null ? String(row.status).toLowerCase().trim() : '';
  if (ACTIVE_SUBSCRIPTION_STATUSES.has(status)) {
    const endMs = subscriptionPeriodEndMs(row);
    if (endMs != null && endMs <= Date.now()) return 'expired';
  }

  return status || 'unknown';
}

/** Admin table: cancelled only on latest renewal row; prior periods show expired. */
function displaySubscriptionStatusForAdmin(row, groupContext, webhookCancelledIds, webhookCancelledProviderIds) {
  const sid = String(row.subscription_id);
  const storeKey = groupContext.subscriptionStoreKey(row);
  const isSuperseded = groupContext.supersededIds.has(sid);
  const isHead = groupContext.headIds.has(sid);
  const groupIsCancelled = groupContext.groupCancelled.get(storeKey) === true;

  if (isSuperseded) {
    return 'expired';
  }

  if (isHead && groupIsCancelled) {
    return 'cancelled';
  }

  if (rowHasCancellationSignals(row, webhookCancelledIds, webhookCancelledProviderIds)) {
    return isHead ? 'cancelled' : 'expired';
  }

  return displaySubscriptionStatus(row);
}

/** SQL fragment — keep in sync with {@link rowHasCancellationSignals} (excluding webhook flags). */
function subscriptionRowIsCancelledSql(alias) {
  return `(
    LOWER(TRIM(COALESCE(${alias}.status, ''))) = 'cancelled'
    OR ${alias}.cancelled_at IS NOT NULL
    OR (
      JSON_VALID(${alias}.subscription_additional_data)
      AND JSON_EXTRACT(${alias}.subscription_additional_data, '$.cancellation_metadata') IS NOT NULL
    )
    OR (
      JSON_VALID(${alias}.subscription_additional_data)
      AND LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${alias}.subscription_additional_data, '$.status')), ''))) = 'cancelled'
    )
    OR (
      JSON_VALID(${alias}.subscription_additional_data)
      AND LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${alias}.subscription_additional_data, '$.cancellation_source')), ''))) IN ('webhook', 'api')
    )
    OR (
      JSON_VALID(${alias}.subscription_additional_data)
      AND LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${alias}.subscription_additional_data, '$.provider_response.status')), ''))) = 'cancelled'
    )
  )`;
}

module.exports = {
  ACTIVE_SUBSCRIPTION_STATUSES,
  parseSubscriptionAdditionalData,
  subscriptionPeriodEndMs,
  additionalDataIndicatesCancellation,
  buildSupersededByRenewalSet,
  buildSubscriptionGroupDisplayContext,
  subscriptionRowIsCancelled,
  displaySubscriptionStatus,
  displaySubscriptionStatusForAdmin,
  subscriptionRowIsCancelledSql
};

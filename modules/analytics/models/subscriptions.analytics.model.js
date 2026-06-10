'use strict';

const moment = require('moment-timezone');
const MysqlQueryRunner = require('../../core/models/mysql.promise.model');
const {
  runQueryingInSlave: runClickHouseQueryInSlave
} = require('../../core/models/clickhouse.promise.model');
const {
  subscriptionRowIsCancelledSql: subscriptionCancellationSignalsSql
} = require('../../orders/utils/subscriptionDisplayStatus.util');

/**
 * Statuses considered "alive" for an entitled recurring subscription.
 * Kept in one place so range/snapshot/daily queries stay in lock-step.
 * @readonly
 */
const ALIVE_STATUSES = Object.freeze([
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

function parseMysqlUtcTimestampToMoment(ts) {
  if (ts instanceof Date) {
    return moment.utc(ts);
  }
  if (typeof ts === 'string' && ts.trim() !== '') {
    return moment.utc(ts.trim(), 'YYYY-MM-DD HH:mm:ss', true);
  }
  return null;
}

function normalizePreviousSubscriptionId(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === 'null') return null;
  if (!/^\d+$/.test(s)) return null;
  return s;
}

/**
 * Exclude only plan-upgrade rows where the upgraded-from subscription (`notes.active_subscription_id`)
 * has the same **UTC calendar date** as this row's `COALESCE(start_at, created_at)` (entitlement queries).
 * Other upgrades remain in the pool. Renewal ranking logic is unchanged.
 */
const EXCLUDE_SAME_CALENDAR_DAY_UPGRADE_ENTITLEMENT_SQL = `
  AND NOT (
    JSON_VALID(s.additional_data)
    AND LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.notes.type')), ''))) = 'upgrade'
    AND EXISTS (
      SELECT 1 FROM subscriptions p
      WHERE NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.notes.active_subscription_id'))), '') REGEXP '^[0-9]+$'
        AND p.subscription_id = CAST(
          NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.notes.active_subscription_id'))), '')
          AS UNSIGNED
        )
        AND DATE(COALESCE(s.start_at, s.created_at)) = DATE(COALESCE(p.start_at, p.created_at))
    )
  )
`;

/** One entitled subscriber per account or unclaimed device (mobile guest sync). */
const ENTITLEMENT_ANCHOR_SQL = `COALESCE(CAST(s.user_id AS CHAR), CONCAT('device:', s.device_id))`;
const ENTITLEMENT_ANCHOR_FILTER_SQL = `AND (s.user_id IS NOT NULL OR s.device_id IS NOT NULL)`;

/** orders.device_id vs subscriptions.device_id can differ in collation after additive migrations. */
const PURCHASER_TEXT_COLLATION = 'utf8mb4_unicode_ci';

function sqlCollateText(expr) {
  return `CONVERT(${expr} USING utf8mb4) COLLATE ${PURCHASER_TEXT_COLLATION}`;
}

/** Subscription period-end columns are IST wall-clock literals (moment.unix().format); convert before UTC compare. */
const SUBSCRIPTION_PERIOD_END_STORAGE_TZ = '+05:30';

/** Period end as UTC epoch seconds — avoids SESSION tz bugs when mixing TIMESTAMP + DATETIME. */
const subscriptionPeriodEndUnixSql = (alias) =>
  `UNIX_TIMESTAMP(CONVERT_TZ(COALESCE(${alias}.current_period_end, ${alias}.renews_at, ${alias}.end_at), '${SUBSCRIPTION_PERIOD_END_STORAGE_TZ}', '+00:00'))`;

/** Later billing-period row points at this subscription_id via previous_subscription_id. */
const subscriptionSupersededByRenewalSql = (alias) =>
  `EXISTS (
    SELECT 1 FROM subscriptions s_sup
    WHERE s_sup.payment_type = 'recurring'
      AND (
        (${alias}.user_id IS NOT NULL AND s_sup.user_id = ${alias}.user_id)
        OR (
          ${alias}.user_id IS NULL
          AND ${alias}.device_id IS NOT NULL
          AND s_sup.user_id IS NULL
          AND ${sqlCollateText('s_sup.device_id')} = ${sqlCollateText(`${alias}.device_id`)}
        )
      )
      AND JSON_VALID(s_sup.additional_data)
      AND JSON_UNQUOTE(JSON_EXTRACT(s_sup.additional_data, '$.previous_subscription_id')) = ${alias}.subscription_id
  )`;

/** Cancelled for display — not on superseded period rows (renewal/resubscribe replaced that billing period). */
const subscriptionRowIsCancelledSql = (alias) =>
  `(
    NOT ${subscriptionSupersededByRenewalSql(alias)}
    AND ${subscriptionCancellationSignalsSql(alias)}
  )`;

/** True when stored period end is null/open-ended or still in the future at UTC `asOf` (bound param). */
const subscriptionPeriodEndAfterUtcParamSql = (alias, paramPlaceholder) =>
  `(COALESCE(${alias}.current_period_end, ${alias}.renews_at, ${alias}.end_at) IS NULL OR ${subscriptionPeriodEndUnixSql(alias)} > UNIX_TIMESTAMP(${paramPlaceholder}))`;

/** True when stored period end exists and is still in the future at UTC `asOf` (bound param). */
const subscriptionPeriodEndStrictlyAfterUtcParamSql = (alias, paramPlaceholder) =>
  `(COALESCE(${alias}.current_period_end, ${alias}.renews_at, ${alias}.end_at) IS NOT NULL AND ${subscriptionPeriodEndUnixSql(alias)} > UNIX_TIMESTAMP(${paramPlaceholder}))`;

/** Nearest completed order for subscription row (user or guest device anchor). */
const LINKED_ORDER_MATCH_SQL = `
  (
    (s.user_id IS NOT NULL AND o.user_id = s.user_id)
    OR (
      s.user_id IS NULL
      AND s.device_id IS NOT NULL
      AND ${sqlCollateText('o.device_id')} = ${sqlCollateText('s.device_id')}
    )
  )
`;

/** When checkout happened in our system — reliable for linking orders (not RC-billing \`start_at\`). */
const SUBSCRIPTION_ADMIN_ORDER_LINK_ANCHOR_SQL = 's.created_at';

/**
 * Recurring subscriptions entitled to access at a point in time (UTC),
 * aligned with api subscription.model recurringRowIsEntitled semantics.
 *
 * Counts are **one per user**: among recurring rows with
 * `COALESCE(start_at, created_at) <= as_of`, only each user's latest row
 * (by `created_at DESC`, `subscription_id DESC`) is considered, then the same
 * status / period-end rules as before apply.
 * Same-day plan upgrades (`notes.type = 'upgrade'` with same UTC start date as the prior row) are excluded from the candidate set.
 */
class SubscriptionsAnalyticsModel {
  /**
   * Recurring subscriptions whose entitlement window overlaps [rangeStartUtc, rangeEndUtc]
   * (UTC). Uses the same status / period-end rules as {@link countRecurringEntitledAt}, but
   * counts rows active for any instant in the range instead of only at range end.
   * One row per user (latest recurring row as of range end).
   * Same-day plan upgrades only: `notes.type = 'upgrade'` and `notes.active_subscription_id` points to
   * a row whose start shares the **same UTC calendar date** as this row's start — excluded from the candidate set.
   */
  static async countRecurringEntitledOverlappingRange(rangeStartUtcDatetime, rangeEndUtcDatetime) {
    const aliveCsv = ALIVE_STATUSES.map((s) => `'${s}'`).join(', ');
    // Renewal rows refresh `start_at` (and current_period_end) for the same user; ordering by
    // COALESCE(start_at, created_at) DESC keeps the renewed row "latest" — same key the User
    // subscriptions admin table dedupes on, so all three views agree on which row represents the user.
    const query = `
      WITH ranked AS (
        SELECT s.*,
          ROW_NUMBER() OVER (
            PARTITION BY ${ENTITLEMENT_ANCHOR_SQL}
            ORDER BY COALESCE(s.start_at, s.created_at) DESC, s.created_at DESC, s.subscription_id DESC
          ) AS rn
        FROM subscriptions s
        WHERE s.payment_type = 'recurring' ${ENTITLEMENT_ANCHOR_FILTER_SQL}
          ${EXCLUDE_SAME_CALENDAR_DAY_UPGRADE_ENTITLEMENT_SQL}
          AND COALESCE(s.start_at, s.created_at) <= ?
      )
      SELECT COUNT(*) AS cnt
      FROM ranked r
      WHERE r.rn = 1
        AND (
          ${subscriptionPeriodEndAfterUtcParamSql('r', '?')}
        )
        AND (
          r.status IN (${aliveCsv})
          OR (
            r.status = 'cancelled'
            AND COALESCE(r.current_period_end, r.renews_at, r.end_at) IS NOT NULL
          )
        )
    `;

    const rows = await MysqlQueryRunner.runQueryInSlave(query, [
      rangeEndUtcDatetime,
      rangeStartUtcDatetime
    ]);
    return Number(rows[0]?.cnt || 0);
  }

  /**
   * Snapshot count of entitled recurring subscribers at `asOfUtcDatetime` (one per user).
   * Same-day plan upgrades only: `notes.type = 'upgrade'` and `notes.active_subscription_id` points to
   * a row whose start shares the **same UTC calendar date** as this row's start — excluded from the candidate set.
   */
  static async countRecurringEntitledAt(asOfUtcDatetime) {
    const aliveCsv = ALIVE_STATUSES.map((s) => `'${s}'`).join(', ');
    const query = `
      WITH ranked AS (
        SELECT s.*,
          ROW_NUMBER() OVER (
            PARTITION BY ${ENTITLEMENT_ANCHOR_SQL}
            ORDER BY COALESCE(s.start_at, s.created_at) DESC, s.created_at DESC, s.subscription_id DESC
          ) AS rn
        FROM subscriptions s
        WHERE s.payment_type = 'recurring' ${ENTITLEMENT_ANCHOR_FILTER_SQL}
          ${EXCLUDE_SAME_CALENDAR_DAY_UPGRADE_ENTITLEMENT_SQL}
          AND COALESCE(s.start_at, s.created_at) <= ?
      )
      SELECT COUNT(*) AS cnt
      FROM ranked r
      WHERE r.rn = 1
        AND (
          (
            r.status IN (${aliveCsv})
            AND (
              ${subscriptionPeriodEndAfterUtcParamSql('r', '?')}
            )
          )
          OR (
            r.status = 'cancelled'
            AND ${subscriptionPeriodEndStrictlyAfterUtcParamSql('r', '?')}
          )
        )
    `;

    const rows = await MysqlQueryRunner.runQueryInSlave(query, [
      asOfUtcDatetime,
      asOfUtcDatetime,
      asOfUtcDatetime
    ]);
    return Number(rows[0]?.cnt || 0);
  }

  /**
   * Per-user entitled snapshot at **UTC now** (MySQL UTC_TIMESTAMP()) — same rules as
   * {@link countRecurringEntitledAt}.
   *
   * @param {string[]} userIds
   * @param {{ useMaster?: boolean }} [options] read primary after admin writes (avoid replica lag)
   * @returns {Promise<Map<string, object>>} user_id → subscription row
   */
  static async loadEntitledSnapshotSubsByUserIds(userIds, options = {}) {
    const out = new Map();
    const ids = [...new Set((userIds || []).map((x) => (x != null ? String(x).trim() : '')).filter(Boolean))];
    if (!ids.length) return out;

    const runQuery =
      options.useMaster === true ? MysqlQueryRunner.runQueryInMaster : MysqlQueryRunner.runQueryInSlave;

    const ph = ids.map(() => '?').join(',');
    const aliveCsv = ALIVE_STATUSES.map((s) => `'${s}'`).join(', ');
    const query = `
      WITH ranked AS (
        SELECT s.subscription_id,
               s.user_id,
               s.provider_plan_id,
               s.status,
               s.provider_subscription_id,
               s.start_at,
               s.current_period_end,
               s.renews_at,
               s.end_at,
               s.created_at,
               s.payment_type,
               s.provider,
          ROW_NUMBER() OVER (
            PARTITION BY s.user_id
            ORDER BY COALESCE(s.start_at, s.created_at) DESC, s.created_at DESC, s.subscription_id DESC
          ) AS rn
        FROM subscriptions s
        WHERE s.payment_type = 'recurring' AND s.user_id IS NOT NULL
          AND s.user_id IN (${ph})
          ${EXCLUDE_SAME_CALENDAR_DAY_UPGRADE_ENTITLEMENT_SQL}
          AND COALESCE(s.start_at, s.created_at) <= UTC_TIMESTAMP()
      )
      SELECT subscription_id,
             user_id,
             provider_plan_id,
             status,
             provider_subscription_id,
             start_at,
             current_period_end,
             renews_at,
             end_at,
             created_at,
             payment_type,
             provider
      FROM ranked r
      WHERE r.rn = 1
        AND (
          (
            r.status IN (${aliveCsv})
            AND ${subscriptionPeriodEndAfterUtcParamSql('r', 'UTC_TIMESTAMP()')}
          )
          OR (
            r.status = 'cancelled'
            AND ${subscriptionPeriodEndStrictlyAfterUtcParamSql('r', 'UTC_TIMESTAMP()')}
          )
        )
    `;

    const rows = await runQuery(query, [...ids]);
    for (const r of Array.isArray(rows) ? rows : []) {
      if (r.user_id != null) out.set(String(r.user_id), r);
    }
    return out;
  }

  /**
   * For each calendar day, count **users** whose latest recurring subscription **overlapped that day**
   * in the client timezone (start ≤ day end, period end &gt; day start or open-ended), with the same
   * status rules as {@link countRecurringEntitledAt}.
   *
   * @param {{ date: string, dayStartUtc: string, dayEndUtc: string }[]} days
   * @returns {Promise<{ date: string, count: number }[]>}
   */
  static async countRecurringEntitledDaily(days) {
    if (!Array.isArray(days) || days.length === 0) return [];

    const aliveCsv = ALIVE_STATUSES.map((s) => `'${s}'`).join(', ');
    const dayUnion = days
      .map(() => 'SELECT ? AS day_key, ? AS day_start_utc, ? AS day_end_utc')
      .join(' UNION ALL ');

    const query = `
      WITH days AS (
        ${dayUnion}
      ),
      ranked AS (
        SELECT d.day_key,
          d.day_start_utc,
          s.*,
          ROW_NUMBER() OVER (
            PARTITION BY d.day_key, ${ENTITLEMENT_ANCHOR_SQL}
            ORDER BY COALESCE(s.start_at, s.created_at) DESC, s.created_at DESC, s.subscription_id DESC
          ) AS rn
        FROM days d
        INNER JOIN subscriptions s
          ON s.payment_type = 'recurring'
          ${ENTITLEMENT_ANCHOR_FILTER_SQL}
          AND COALESCE(s.start_at, s.created_at) <= d.day_end_utc
          ${EXCLUDE_SAME_CALENDAR_DAY_UPGRADE_ENTITLEMENT_SQL}
      ),
      entitled_latest AS (
        SELECT r.day_key, r.subscription_id
        FROM ranked r
        WHERE r.rn = 1
          AND (
            (
              r.status IN (${aliveCsv})
              AND ${subscriptionPeriodEndAfterUtcParamSql('r', 'r.day_start_utc')}
            )
            OR (
              r.status = 'cancelled'
              AND ${subscriptionPeriodEndStrictlyAfterUtcParamSql('r', 'r.day_start_utc')}
            )
          )
      )
      SELECT d.day_key, COUNT(e.subscription_id) AS cnt
      FROM days d
      LEFT JOIN entitled_latest e ON e.day_key = d.day_key
      GROUP BY d.day_key
    `;

    const params = days.flatMap((d) => [d.date, d.dayStartUtc, d.dayEndUtc]);
    const rows = await MysqlQueryRunner.runQueryInSlave(query, params);

    const byDayKey = new Map();
    for (const r of rows || []) {
      byDayKey.set(String(r.day_key), Number(r.cnt) || 0);
    }
    return days.map((d) => ({
      date: d.date,
      count: byDayKey.get(d.date) || 0
    }));
  }

  /**
   * UTC bounds for calendar days in a client tz (same semantics as orders analytics).
   * Inclusive whole days: local `YYYY-MM-DD 00:00:00.000` through `YYYY-MM-DD 23:59:59.999`.
   * @param {string} startCal YYYY-MM-DD
   * @param {string} endCal YYYY-MM-DD
   * @param {string} tz IANA
   * @returns {{ rangeStartUtc: string, rangeEndUtc: string }}
   */
  static utcRangeForCalendarDays(startCal, endCal, tz) {
    const rangeStartUtc = moment.tz(`${startCal} 00:00:00.000`, tz).utc().format('YYYY-MM-DD HH:mm:ss.SSS');
    const rangeEndUtc = moment.tz(`${endCal} 23:59:59.999`, tz).utc().format('YYYY-MM-DD HH:mm:ss.SSS');
    return { rangeStartUtc, rangeEndUtc };
  }

  /**
   * Daily breakdown of recurring subscription events (initial purchases + renewals) for rows whose
   * **entitlement window overlaps** [startCal, endCal] in `tz` (same overlap rule as {@link listUserSubscriptionsForAdminRange}).
   *
   * Each row is still **bucketed by its purchase/start calendar day** in `tz` (duplicate rows omitted from the picker’s
   * range naturally drop once buckets are clipped to `[startCal, endCal]`).
   *
   * Renewals are detected via `additional_data.previous_subscription_id` or
   * `additional_data.renewal_count > 0` (matches how `subscription.service.js` writes renewal rows).
   * Anything else with `payment_type = 'recurring'` is counted as an initial subscription event.
   * A renewal row is skipped when `previous_subscription_id` resolves to a parent whose
   * `COALESCE(start_at, created_at)` falls on the same calendar day as this row in `tz`
   * (avoids same-day activation + first-cycle charge counting as both new and renewal).
   * Same-day **plan upgrade** rows (`notes.type = 'upgrade'` with `notes.active_subscription_id` whose
   * start falls on the same calendar day as this row in `tz`) are omitted from the chart buckets.
   *
   * @param {Object} opts
   * @param {string} opts.startCal YYYY-MM-DD
   * @param {string} opts.endCal YYYY-MM-DD
   * @param {string} opts.tz IANA timezone for calendar day bucketing
   * @returns {Promise<{ daily: Array<{ date: string, initial: number, renewal: number, count: number }> }>}
   */
  static async getSubscriptionEventsDaily(opts) {
    const { startCal, endCal, tz } = opts;
    const { rangeStartUtc, rangeEndUtc } = SubscriptionsAnalyticsModel.utcRangeForCalendarDays(startCal, endCal, tz);

    // Pull recurring rows overlapping whole-day UTC bounds — same predicates as {@link listUserSubscriptionsForAdminRange}.
    // Bucketing into local-tz calendar days happens in Node so we don't depend on MySQL named-tz tables.
    const query = `
      SELECT
        DATE_FORMAT(COALESCE(s.start_at, s.created_at), '%Y-%m-%d %H:%i:%s') AS ts_utc,
        CASE
          WHEN JSON_VALID(s.additional_data) AND (
            JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.previous_subscription_id')) IS NOT NULL
              AND JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.previous_subscription_id')) <> ''
              AND JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.previous_subscription_id')) <> 'null'
            OR CAST(JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.renewal_count')) AS UNSIGNED) > 0
          ) THEN 1
          ELSE 0
        END AS is_renewal,
        JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.previous_subscription_id')) AS prev_sub_id_raw,
        CASE
          WHEN JSON_VALID(s.additional_data) AND LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.notes.type')), ''))) = 'upgrade'
          THEN 1
          ELSE 0
        END AS is_upgrade,
        JSON_UNQUOTE(JSON_EXTRACT(s.additional_data, '$.notes.active_subscription_id')) AS upgrade_parent_id_raw
      FROM subscriptions s
      WHERE s.payment_type = 'recurring' ${ENTITLEMENT_ANCHOR_FILTER_SQL}
        AND s.created_at <= ?
        AND (
          COALESCE(s.current_period_end, s.renews_at, s.end_at) IS NULL
          OR COALESCE(s.current_period_end, s.renews_at, s.end_at) >= ?
        )
    `;

    const rows = await MysqlQueryRunner.runQueryInSlave(query, [rangeEndUtc, rangeStartUtc]);

    const prevIds = new Set();
    for (const r of rows || []) {
      if (Number(r.is_renewal) === 1) {
        const pid = normalizePreviousSubscriptionId(r.prev_sub_id_raw);
        if (pid) prevIds.add(pid);
      }
      if (Number(r.is_upgrade) === 1) {
        const upId = normalizePreviousSubscriptionId(r.upgrade_parent_id_raw);
        if (upId) prevIds.add(upId);
      }
    }

    /** @type {Map<string, string>} subscription_id -> calendar day (client tz) of parent's COALESCE(start_at, created_at) */
    const parentStartDayById = new Map();
    if (prevIds.size > 0) {
      const idList = [...prevIds];
      const placeholders = idList.map(() => '?').join(', ');
      const parentRows = await MysqlQueryRunner.runQueryInSlave(
        `SELECT subscription_id,
          DATE_FORMAT(COALESCE(start_at, created_at), '%Y-%m-%d %H:%i:%s') AS ts_utc
         FROM subscriptions
         WHERE subscription_id IN (${placeholders})`,
        idList
      );
      for (const pr of parentRows || []) {
        const m = parseMysqlUtcTimestampToMoment(pr.ts_utc);
        if (!m || !m.isValid()) continue;
        parentStartDayById.set(String(pr.subscription_id), m.tz(tz).format('YYYY-MM-DD'));
      }
    }

    // Bucket into calendar days in `tz`.
    // Omit same-day plan upgrades (upgrade row vs prior subscription start, client tz).
    // Suppress a "renewal" row when its parent subscription started the same calendar day (Razorpay
    // activation + charged with paid_count > 1 on one day).
    const buckets = new Map();
    for (const r of rows || []) {
      const m = parseMysqlUtcTimestampToMoment(r.ts_utc);
      if (!m || !m.isValid()) continue;
      const day = m.tz(tz).format('YYYY-MM-DD');

      if (Number(r.is_upgrade) === 1) {
        const upPid = normalizePreviousSubscriptionId(r.upgrade_parent_id_raw);
        if (upPid) {
          const upgradedFromDay = parentStartDayById.get(upPid);
          if (upgradedFromDay && upgradedFromDay === day) {
            continue;
          }
        }
      }

      if (Number(r.is_renewal) === 1) {
        const pid = normalizePreviousSubscriptionId(r.prev_sub_id_raw);
        if (pid) {
          const parentDay = parentStartDayById.get(pid);
          if (parentDay && parentDay === day) {
            continue;
          }
        }
      }

      const cur = buckets.get(day) || { initial: 0, renewal: 0 };
      if (Number(r.is_renewal) === 1) cur.renewal += 1;
      else cur.initial += 1;
      buckets.set(day, cur);
    }

    const daily = Array.from(buckets.entries())
      .filter(([date]) => date >= startCal && date <= endCal)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({
        date,
        initial: v.initial,
        renewal: v.renewal,
        count: v.initial + v.renewal
      }));

    return { daily };
  }

  /**
   * Resolve `payment_plans` metadata for subscription rows keyed by `provider_plan_id`
   * (numeric pp_id or store SKU via `payment_gateway_plans`).
   * @param {unknown[]} providerPlanIds
   * @param {{ useMaster?: boolean }} [options] use primary DB for reads (admin / read-your-writes)
   * @returns {Promise<Map<string, { plan_name: string|null, billing_interval: string|null, plan_type: string|null, credits: number|null, bonus_credits: number|null }>>}
   */
  static async resolvePlanMetadataForProviderPlanIds(providerPlanIds, options = {}) {
    const useMaster = options.useMaster === true;
    const runQuery = useMaster ? MysqlQueryRunner.runQueryInMaster : MysqlQueryRunner.runQueryInSlave;

    const unique = [
      ...new Set(
        (providerPlanIds || [])
          .filter((x) => x != null && String(x).trim() !== '')
          .map((x) => String(x).trim())
      )
    ];
    const map = new Map();
    if (!unique.length) return map;

    const numericIds = unique.filter((id) => /^\d+$/.test(id)).map((id) => parseInt(id, 10));
    if (numericIds.length) {
      const rows = await runQuery(
        'SELECT pp_id, plan_name, billing_interval, plan_type, credits, bonus_credits FROM payment_plans WHERE pp_id IN (?)',
        [numericIds]
      );
      for (const r of rows || []) {
        map.set(String(r.pp_id), {
          plan_name: r.plan_name != null ? String(r.plan_name) : null,
          billing_interval: r.billing_interval != null ? String(r.billing_interval) : null,
          plan_type: r.plan_type != null ? String(r.plan_type) : null,
          credits: r.credits != null ? Number(r.credits) : null,
          bonus_credits: r.bonus_credits != null ? Number(r.bonus_credits) : null
        });
      }
    }

    const stringSkus = unique.filter((id) => !/^\d+$/.test(id));
    if (stringSkus.length) {
      const rows = await runQuery(
        `SELECT pp.plan_name, pp.billing_interval, pp.plan_type, pp.credits, pp.bonus_credits,
                pgp.pg_plan_id, pgp.pg_plan_id_ios, pgp.pg_plan_id_android
         FROM payment_gateway_plans pgp
         INNER JOIN payment_plans pp ON pp.pp_id = pgp.payment_plan_id
         WHERE pgp.is_active = 1
           AND (
             pgp.pg_plan_id IN (?)
             OR pgp.pg_plan_id_ios IN (?)
             OR pgp.pg_plan_id_android IN (?)
           )`,
        [stringSkus, stringSkus, stringSkus]
      );
      for (const sku of stringSkus) {
        if (map.has(sku)) continue;
        const hit = (rows || []).find(
          (r) => r.pg_plan_id === sku || r.pg_plan_id_ios === sku || r.pg_plan_id_android === sku
        );
        if (hit) {
          map.set(sku, {
            plan_name: hit.plan_name != null ? String(hit.plan_name) : null,
            billing_interval: hit.billing_interval != null ? String(hit.billing_interval) : null,
            plan_type: hit.plan_type != null ? String(hit.plan_type) : null,
            credits: hit.credits != null ? Number(hit.credits) : null,
            bonus_credits: hit.bonus_credits != null ? Number(hit.bonus_credits) : null
          });
        }
      }
    }

    return map;
  }

  /**
   * Admin Purchases tab: subscriptions that **overlap** the calendar range [startCal, endCal] in `tz`.
   * Bounds are whole days: first day 00:00:00 through last day 23:59:59.999 (see {@link utcRangeForCalendarDays}).
   * A row is included when purchase/start is on or before the range end and paid-through (period end) is
   * on or after the range start, or period end is missing (treated as open-ended for overlap).
   * One row per matching `subscriptions` row (renewals appear as separate rows).
   *
   * @param {Object} opts
   * @param {string} opts.startCal YYYY-MM-DD
   * @param {string} opts.endCal YYYY-MM-DD
   * @param {string} opts.tz IANA
   * @param {string} [opts.clientPlatform] '' | 'ios' | 'android' | 'web'
   * @param {number|null} [opts.paymentPlanId] internal `payment_plans.pp_id` — matches numeric `provider_plan_id` or gateway SKU rows for that plan
   * @param {string} [opts.subscriptionEventType] '' | renewal | initial | upgrade | one_time (matches admin DTO classification)
   * @param {string} [opts.subscriptionDisplayStatus] lowercase display status (matches {@link orders.analytics.controller} display rules)
   * @param {number} opts.limit
   * @param {number} opts.offset
   * @param {boolean} [opts.useMaster] read from primary (avoids replica lag after admin writes / seeds)
   * @returns {Promise<{ rows: object[], total: number }>}
   */
  static async listUserSubscriptionsForAdminRange(opts) {
    const {
      startCal,
      endCal,
      tz,
      clientPlatform = '',
      paymentPlanId = null,
      subscriptionEventType = '',
      subscriptionDisplayStatus = '',
      limit,
      offset,
      useMaster = false
    } = opts;
    const runQuery = useMaster ? MysqlQueryRunner.runQueryInMaster : MysqlQueryRunner.runQueryInSlave;
    const { rangeStartUtc, rangeEndUtc } = SubscriptionsAnalyticsModel.utcRangeForCalendarDays(startCal, endCal, tz);

    const pf = clientPlatform != null ? String(clientPlatform).trim().toLowerCase() : '';

    const platformClause =
      pf === ''
        ? { sql: '', params: [] }
        : { sql: ' AND t.linked_client_platform = ? ', params: [pf] };

    let planClause = { sql: '', params: [] };
    const ppId = paymentPlanId != null && Number.isFinite(Number(paymentPlanId)) ? Number(paymentPlanId) : null;
    if (ppId != null && ppId > 0) {
      planClause = {
        sql: ` AND (
          (s.provider_plan_id REGEXP '^[0-9]+$' AND CAST(s.provider_plan_id AS UNSIGNED) = ?)
          OR EXISTS (
            SELECT 1 FROM payment_gateway_plans pgp
            WHERE pgp.payment_plan_id = ?
              AND pgp.is_active = 1
              AND (
                pgp.pg_plan_id = s.provider_plan_id
                OR pgp.pg_plan_id_ios = s.provider_plan_id
                OR pgp.pg_plan_id_android = s.provider_plan_id
              )
          )
        ) `,
        params: [ppId, ppId]
      };
    }

    const rawEt = subscriptionEventType != null ? String(subscriptionEventType).trim() : '';
    const et = ['renewal', 'initial', 'upgrade', 'one_time'].includes(rawEt) ? rawEt : '';
    const eventClause = et ? { sql: ' AND t._event_type = ? ', params: [et] } : { sql: '', params: [] };

    const rawSt = subscriptionDisplayStatus != null ? String(subscriptionDisplayStatus).trim().toLowerCase() : '';
    const statusClause = rawSt ? { sql: ' AND t._display_status = ? ', params: [rawSt] } : { sql: '', params: [] };

    const innerParams = [rangeEndUtc, rangeStartUtc, ...planClause.params];

    const baseRowsSelect = `
      SELECT
        s.subscription_id,
        s.user_id,
        s.device_id,
        s.claimed_at,
        CASE
          WHEN s.user_id IS NOT NULL THEN COALESCE(
            NULLIF(TRIM(u.display_name), ''),
            NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''),
            NULLIF(TRIM(u.email), ''),
            CAST(s.user_id AS CHAR)
          )
          WHEN s.device_id IS NOT NULL THEN CONCAT(
            'Guest device',
            IF(CHAR_LENGTH(s.device_id) > 8, CONCAT(' · ', RIGHT(s.device_id, 8)), '')
          )
          ELSE NULL
        END AS user_name,
        s.provider_subscription_id,
        s.provider_plan_id,
        s.provider AS subscription_provider,
        s.payment_type,
        s.status,
        s.cancelled_at,
        s.start_at,
        s.created_at,
        s.renews_at,
        s.current_period_end,
        s.end_at,
        (
          SELECT o.client_platform
          FROM orders o
          WHERE o.status = 'completed'
            AND o.completed_at IS NOT NULL
            AND ${LINKED_ORDER_MATCH_SQL}
            AND o.completed_at >= DATE_SUB(${SUBSCRIPTION_ADMIN_ORDER_LINK_ANCHOR_SQL}, INTERVAL 2 DAY)
            AND o.completed_at <= DATE_ADD(${SUBSCRIPTION_ADMIN_ORDER_LINK_ANCHOR_SQL}, INTERVAL 2 DAY)
          ORDER BY ABS(TIMESTAMPDIFF(SECOND, o.completed_at, ${SUBSCRIPTION_ADMIN_ORDER_LINK_ANCHOR_SQL})) ASC,
            o.order_id DESC
          LIMIT 1
        ) AS linked_client_platform,
        (
          SELECT o.payment_gateway
          FROM orders o
          WHERE o.status = 'completed'
            AND o.completed_at IS NOT NULL
            AND ${LINKED_ORDER_MATCH_SQL}
            AND o.completed_at >= DATE_SUB(${SUBSCRIPTION_ADMIN_ORDER_LINK_ANCHOR_SQL}, INTERVAL 2 DAY)
            AND o.completed_at <= DATE_ADD(${SUBSCRIPTION_ADMIN_ORDER_LINK_ANCHOR_SQL}, INTERVAL 2 DAY)
          ORDER BY ABS(TIMESTAMPDIFF(SECOND, o.completed_at, ${SUBSCRIPTION_ADMIN_ORDER_LINK_ANCHOR_SQL})) ASC,
            o.order_id DESC
          LIMIT 1
        ) AS linked_order_gateway,
        s.additional_data AS subscription_additional_data
      FROM subscriptions s
      LEFT JOIN user u ON u.user_id = s.user_id
      WHERE (s.user_id IS NULL OR u.DELETED_AT IS NULL)
        ${ENTITLEMENT_ANCHOR_FILTER_SQL}
        AND s.created_at <= ?
        AND (
          COALESCE(s.current_period_end, s.renews_at, s.end_at) IS NULL
          OR COALESCE(s.current_period_end, s.renews_at, s.end_at) >= ?
        )
        ${planClause.sql}
    `;

    const augmentedFrom = `
      SELECT
        inner_sub.*,
        CASE
          WHEN inner_sub.start_at IS NULL THEN inner_sub.created_at
          WHEN inner_sub.created_at IS NULL THEN inner_sub.start_at
          WHEN DATEDIFF(inner_sub.created_at, inner_sub.start_at) <= 1 THEN inner_sub.start_at
          ELSE DATE_SUB(
            COALESCE(inner_sub.renews_at, inner_sub.current_period_end),
            INTERVAL (
              COALESCE(
                (
                  SELECT TIMESTAMPDIFF(SECOND, s2.start_at, COALESCE(s2.renews_at, s2.current_period_end))
                  FROM subscriptions s2
                  WHERE (
                      (inner_sub.user_id IS NOT NULL AND s2.user_id = inner_sub.user_id)
                      OR (
                        inner_sub.user_id IS NULL
                        AND inner_sub.device_id IS NOT NULL
                        AND s2.user_id IS NULL
                        AND ${sqlCollateText('s2.device_id')} = ${sqlCollateText('inner_sub.device_id')}
                      )
                    )
                    AND s2.provider_plan_id = inner_sub.provider_plan_id
                    AND DATEDIFF(s2.created_at, s2.start_at) <= 1
                    AND COALESCE(s2.renews_at, s2.current_period_end) IS NOT NULL
                    AND TIMESTAMPDIFF(
                      SECOND,
                      s2.start_at,
                      COALESCE(s2.renews_at, s2.current_period_end)
                    ) BETWEEN 60 AND 86400 * 400
                  ORDER BY s2.created_at DESC
                  LIMIT 1
                ),
                CASE
                  WHEN JSON_VALID(inner_sub.subscription_additional_data)
                    AND JSON_EXTRACT(inner_sub.subscription_additional_data, '$.current_end') IS NOT NULL
                    AND JSON_EXTRACT(inner_sub.subscription_additional_data, '$.current_start') IS NOT NULL
                    AND CAST(JSON_EXTRACT(inner_sub.subscription_additional_data, '$.current_end') AS UNSIGNED)
                      > CAST(JSON_EXTRACT(inner_sub.subscription_additional_data, '$.current_start') AS UNSIGNED)
                    AND (
                      CAST(JSON_EXTRACT(inner_sub.subscription_additional_data, '$.current_end') AS UNSIGNED)
                      - CAST(JSON_EXTRACT(inner_sub.subscription_additional_data, '$.current_start') AS UNSIGNED)
                    ) BETWEEN 60 AND 86400
                  THEN
                    CAST(JSON_EXTRACT(inner_sub.subscription_additional_data, '$.current_end') AS UNSIGNED)
                    - CAST(JSON_EXTRACT(inner_sub.subscription_additional_data, '$.current_start') AS UNSIGNED)
                  ELSE NULL
                END,
                300
              )
            ) SECOND
          )
        END AS purchase_or_start_at,
        (
          CASE
            WHEN JSON_VALID(inner_sub.subscription_additional_data) AND (
              (
                JSON_UNQUOTE(JSON_EXTRACT(inner_sub.subscription_additional_data, '$.previous_subscription_id')) IS NOT NULL
                AND TRIM(JSON_UNQUOTE(JSON_EXTRACT(inner_sub.subscription_additional_data, '$.previous_subscription_id'))) <> ''
                AND LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(inner_sub.subscription_additional_data, '$.previous_subscription_id')))) <> 'null'
              )
              OR IFNULL(
                CAST(NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(inner_sub.subscription_additional_data, '$.renewal_count'))), '') AS UNSIGNED),
                0
              ) > 0
            ) THEN 'renewal'
            WHEN JSON_VALID(inner_sub.subscription_additional_data)
              AND JSON_UNQUOTE(JSON_EXTRACT(inner_sub.subscription_additional_data, '$.notes.type')) = 'upgrade' THEN 'upgrade'
            WHEN LOWER(TRIM(COALESCE(inner_sub.payment_type, ''))) IN ('one_time', 'onetime') THEN 'one_time'
            ELSE 'initial'
          END
        ) AS _event_type,
        (
          CASE
            WHEN ${subscriptionSupersededByRenewalSql('inner_sub')} THEN 'expired'
            WHEN ${subscriptionRowIsCancelledSql('inner_sub')} THEN 'cancelled'
            WHEN LOWER(TRIM(COALESCE(inner_sub.status, ''))) IN (
              'active','renewed','pending','trial','paused','upgraded',
              'active_non_recurring','upgraded_non_recurring','pending_otp_verification_for_upgrade'
            )
            AND COALESCE(inner_sub.current_period_end, inner_sub.renews_at, inner_sub.end_at) IS NOT NULL
            AND ${subscriptionPeriodEndUnixSql('inner_sub')} <= UNIX_TIMESTAMP(UTC_TIMESTAMP())
              THEN 'expired'
            WHEN inner_sub.status IS NULL OR TRIM(COALESCE(inner_sub.status, '')) = '' THEN 'unknown'
            ELSE LOWER(TRIM(inner_sub.status))
          END
        ) AS _display_status
      FROM (
        ${baseRowsSelect}
      ) inner_sub
    `;

    const filterParams = [...eventClause.params, ...statusClause.params];

    const countQuery = `
      SELECT COUNT(*) AS cnt
      FROM (
        ${augmentedFrom}
      ) t
      WHERE 1=1
      ${platformClause.sql}
      ${eventClause.sql}
      ${statusClause.sql}
    `;

    const countRows = await runQuery(countQuery, [...innerParams, ...platformClause.params, ...filterParams]);
    const total = Number(countRows[0]?.cnt || 0) || 0;

    const listQuery = `
      SELECT * FROM (
        ${augmentedFrom}
      ) t
      WHERE 1=1
      ${platformClause.sql}
      ${eventClause.sql}
      ${statusClause.sql}
      ORDER BY t.purchase_or_start_at DESC, t.subscription_id DESC
      LIMIT ? OFFSET ?
    `;

    const rows = await runQuery(listQuery, [...innerParams, ...platformClause.params, ...filterParams, limit, offset]);

    return { rows: rows || [], total };
  }

  /**
   * Cancellation hints from ClickHouse webhook log (internal row id + store transaction id).
   */
  static async findWebhookCancellationHints({
    subscriptionIds = [],
    providerSubscriptionIds = [],
    userIds = []
  } = {}) {
    const internalIds = [...new Set((subscriptionIds || []).map((id) => String(id).trim()).filter(Boolean))];
    const providerIds = [
      ...new Set((providerSubscriptionIds || []).map((id) => String(id).trim()).filter(Boolean))
    ];
    const purchaserUserIds = [...new Set((userIds || []).map((id) => String(id).trim()).filter(Boolean))];
    const result = { internalIds: new Set(), providerIds: new Set(), userIds: new Set() };
    if (!internalIds.length && !providerIds.length && !purchaserUserIds.length) return result;

    try {
      const clauses = [];
      if (internalIds.length) {
        const inList = internalIds
          .map((id) => `'${String(id).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`)
          .join(', ');
        clauses.push(`JSONExtractString(additional_data, 'subscription_id') IN (${inList})`);
      }
      if (providerIds.length) {
        const inList = providerIds
          .map((id) => `'${String(id).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`)
          .join(', ');
        clauses.push(`JSONExtractString(provider_event_data, 'subscription_id') IN (${inList})`);
      }
      if (purchaserUserIds.length) {
        const inList = purchaserUserIds
          .map((id) => `'${String(id).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`)
          .join(', ');
        clauses.push(`JSONExtractString(additional_data, 'user_id') IN (${inList})`);
      }

      const query = `
        SELECT
          JSONExtractString(additional_data, 'subscription_id') AS internal_subscription_id,
          JSONExtractString(provider_event_data, 'subscription_id') AS provider_subscription_id,
          JSONExtractString(additional_data, 'user_id') AS user_id
        FROM subscription_webhook_events
        WHERE status = 'success'
          AND (
            positionCaseInsensitive(provider_event_id, '_cancel') > 0
            OR JSONExtractString(additional_data, 'event_type') = 'subscription.cancelled'
          )
          AND (${clauses.join(' OR ')})
      `;
      const rows = await runClickHouseQueryInSlave(query);
      for (const row of rows || []) {
        const sid =
          row?.internal_subscription_id != null ? String(row.internal_subscription_id).trim() : '';
        const pid =
          row?.provider_subscription_id != null ? String(row.provider_subscription_id).trim() : '';
        const uid = row?.user_id != null ? String(row.user_id).trim() : '';
        if (sid) result.internalIds.add(sid);
        if (pid) result.providerIds.add(pid);
        if (uid) result.userIds.add(uid);
      }
    } catch (err) {
      console.warn('findWebhookCancellationHints skipped:', err.message);
    }

    return result;
  }

  /** @deprecated use {@link findWebhookCancellationHints} */
  static async findWebhookCancelledSubscriptionIds(subscriptionIds) {
    const hints = await SubscriptionsAnalyticsModel.findWebhookCancellationHints({ subscriptionIds });
    return hints.internalIds;
  }
}

module.exports = SubscriptionsAnalyticsModel;

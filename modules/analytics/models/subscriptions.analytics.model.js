'use strict';

const moment = require('moment-timezone');
const MysqlQueryRunner = require('../../core/models/mysql.promise.model');

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
            PARTITION BY s.user_id
            ORDER BY COALESCE(s.start_at, s.created_at) DESC, s.created_at DESC, s.subscription_id DESC
          ) AS rn
        FROM subscriptions s
        WHERE s.payment_type = 'recurring'
          ${EXCLUDE_SAME_CALENDAR_DAY_UPGRADE_ENTITLEMENT_SQL}
          AND COALESCE(s.start_at, s.created_at) <= ?
      )
      SELECT COUNT(*) AS cnt
      FROM ranked r
      WHERE r.rn = 1
        AND (
          COALESCE(r.current_period_end, r.renews_at, r.end_at) IS NULL
          OR COALESCE(r.current_period_end, r.renews_at, r.end_at) > ?
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
            PARTITION BY s.user_id
            ORDER BY COALESCE(s.start_at, s.created_at) DESC, s.created_at DESC, s.subscription_id DESC
          ) AS rn
        FROM subscriptions s
        WHERE s.payment_type = 'recurring'
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
              COALESCE(r.current_period_end, r.renews_at, r.end_at) IS NULL
              OR COALESCE(r.current_period_end, r.renews_at, r.end_at) > ?
            )
          )
          OR (
            r.status = 'cancelled'
            AND COALESCE(r.current_period_end, r.renews_at, r.end_at) IS NOT NULL
            AND COALESCE(r.current_period_end, r.renews_at, r.end_at) > ?
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
   * @returns {Promise<Map<string, object>>} user_id → subscription row
   */
  static async loadEntitledSnapshotSubsByUserIds(userIds) {
    const out = new Map();
    const ids = [...new Set((userIds || []).map((x) => (x != null ? String(x).trim() : '')).filter(Boolean))];
    if (!ids.length) return out;

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
        WHERE s.payment_type = 'recurring'
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
            AND (
              COALESCE(r.current_period_end, r.renews_at, r.end_at) IS NULL
              OR COALESCE(r.current_period_end, r.renews_at, r.end_at) > UTC_TIMESTAMP()
            )
          )
          OR (
            r.status = 'cancelled'
            AND COALESCE(r.current_period_end, r.renews_at, r.end_at) IS NOT NULL
            AND COALESCE(r.current_period_end, r.renews_at, r.end_at) > UTC_TIMESTAMP()
          )
        )
    `;

    const rows = await MysqlQueryRunner.runQueryInSlave(query, [...ids]);
    for (const r of Array.isArray(rows) ? rows : []) {
      if (r.user_id != null) out.set(String(r.user_id), r);
    }
    return out;
  }

  /**
   * For each calendar day in the supplied list, count **users** whose latest
   * recurring subscription (as of that instant) was entitled — same rules as
   * {@link countRecurringEntitledAt} but computes all snapshots in one query.
   * Same-day plan upgrades only: `notes.type = 'upgrade'` and `notes.active_subscription_id` points to
   * a row whose start shares the **same UTC calendar date** as this row's start — excluded from the candidate set.
   *
   * @param {{ date: string, asOfUtc: string }[]} days
   *   `date` is the calendar day in the client tz (YYYY-MM-DD), `asOfUtc` is
   *   that day's last-second timestamp converted to UTC (`YYYY-MM-DD HH:mm:ss[.SSS]`).
   * @returns {Promise<{ date: string, count: number }[]>}
   *   Same length and order as input `days`. Empty array if `days` is empty.
   */
  static async countRecurringEntitledDaily(days) {
    if (!Array.isArray(days) || days.length === 0) return [];

    const aliveCsv = ALIVE_STATUSES.map((s) => `'${s}'`).join(', ');
    const dayUnion = days.map(() => 'SELECT ? AS day_utc').join(' UNION ALL ');

    const query = `
      WITH days AS (
        ${dayUnion}
      ),
      ranked AS (
        SELECT d.day_utc,
          s.*,
          ROW_NUMBER() OVER (
            PARTITION BY d.day_utc, s.user_id
            ORDER BY COALESCE(s.start_at, s.created_at) DESC, s.created_at DESC, s.subscription_id DESC
          ) AS rn
        FROM days d
        INNER JOIN subscriptions s
          ON s.payment_type = 'recurring'
          AND COALESCE(s.start_at, s.created_at) <= d.day_utc
          ${EXCLUDE_SAME_CALENDAR_DAY_UPGRADE_ENTITLEMENT_SQL}
      ),
      entitled_latest AS (
        SELECT r.day_utc, r.subscription_id
        FROM ranked r
        WHERE r.rn = 1
          AND (
            (
              r.status IN (${aliveCsv})
              AND (
                COALESCE(r.current_period_end, r.renews_at, r.end_at) IS NULL
                OR COALESCE(r.current_period_end, r.renews_at, r.end_at) > r.day_utc
              )
            )
            OR (
              r.status = 'cancelled'
              AND COALESCE(r.current_period_end, r.renews_at, r.end_at) IS NOT NULL
              AND COALESCE(r.current_period_end, r.renews_at, r.end_at) > r.day_utc
            )
          )
      )
      SELECT d.day_utc, COUNT(e.subscription_id) AS cnt
      FROM days d
      LEFT JOIN entitled_latest e ON e.day_utc = d.day_utc
      GROUP BY d.day_utc
    `;

    const params = days.map((d) => d.asOfUtc);
    const rows = await MysqlQueryRunner.runQueryInSlave(query, params);

    const byAsOfUtc = new Map();
    for (const r of rows || []) {
      byAsOfUtc.set(String(r.day_utc), Number(r.cnt) || 0);
    }
    return days.map((d) => ({
      date: d.date,
      count: byAsOfUtc.get(d.asOfUtc) || 0
    }));
  }

  /**
   * UTC bounds for calendar days in a client tz (same semantics as orders analytics).
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
   * Daily breakdown of recurring subscription events (initial purchases + renewals) in [startCal, endCal].
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

    // Pull each recurring subscription row whose start falls in the window.
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
      WHERE s.payment_type = 'recurring'
        AND COALESCE(s.start_at, s.created_at) >= ?
        AND COALESCE(s.start_at, s.created_at) <= ?
    `;

    const rows = await MysqlQueryRunner.runQueryInSlave(query, [rangeStartUtc, rangeEndUtc]);

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
   * Admin Purchases tab: subscriptions whose purchase/start instant falls in the UTC window
   * derived from [startCal, endCal] in `tz`, with optional filters and pagination.
   * One row per `subscriptions` row in range (renewals appear as separate rows).
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

    const innerParams = [rangeStartUtc, rangeEndUtc, ...planClause.params];

    const baseRowsSelect = `
      SELECT
        s.subscription_id,
        s.user_id,
        COALESCE(
          NULLIF(TRIM(u.display_name), ''),
          NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''),
          NULLIF(TRIM(u.email), ''),
          CAST(s.user_id AS CHAR)
        ) AS user_name,
        s.provider_plan_id,
        s.provider AS subscription_provider,
        s.payment_type,
        s.status,
        s.start_at,
        s.created_at,
        s.renews_at,
        s.current_period_end,
        s.end_at,
        COALESCE(s.start_at, s.created_at) AS purchase_or_start_at,
        (
          SELECT o.client_platform
          FROM orders o
          WHERE o.user_id = s.user_id
            AND o.status = 'completed'
            AND o.completed_at IS NOT NULL
            AND o.completed_at >= DATE_SUB(COALESCE(s.start_at, s.created_at), INTERVAL 2 DAY)
            AND o.completed_at <= DATE_ADD(COALESCE(s.start_at, s.created_at), INTERVAL 2 DAY)
          ORDER BY ABS(TIMESTAMPDIFF(SECOND, o.completed_at, COALESCE(s.start_at, s.created_at))) ASC,
            o.order_id DESC
          LIMIT 1
        ) AS linked_client_platform,
        (
          SELECT o.payment_gateway
          FROM orders o
          WHERE o.user_id = s.user_id
            AND o.status = 'completed'
            AND o.completed_at IS NOT NULL
            AND o.completed_at >= DATE_SUB(COALESCE(s.start_at, s.created_at), INTERVAL 2 DAY)
            AND o.completed_at <= DATE_ADD(COALESCE(s.start_at, s.created_at), INTERVAL 2 DAY)
          ORDER BY ABS(TIMESTAMPDIFF(SECOND, o.completed_at, COALESCE(s.start_at, s.created_at))) ASC,
            o.order_id DESC
          LIMIT 1
        ) AS linked_order_gateway,
        s.additional_data AS subscription_additional_data
      FROM subscriptions s
      INNER JOIN user u ON u.user_id = s.user_id
      WHERE (u.DELETED_AT IS NULL)
        AND COALESCE(s.start_at, s.created_at) >= ?
        AND COALESCE(s.start_at, s.created_at) <= ?
        ${planClause.sql}
    `;

    const augmentedFrom = `
      SELECT
        inner_sub.*,
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
            WHEN LOWER(TRIM(COALESCE(inner_sub.status, ''))) IN (
              'active','renewed','pending','trial','paused','upgraded',
              'active_non_recurring','upgraded_non_recurring','pending_otp_verification_for_upgrade'
            )
            AND COALESCE(inner_sub.current_period_end, inner_sub.renews_at, inner_sub.end_at) IS NOT NULL
            AND COALESCE(inner_sub.current_period_end, inner_sub.renews_at, inner_sub.end_at) <= UTC_TIMESTAMP()
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
}

module.exports = SubscriptionsAnalyticsModel;

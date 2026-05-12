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

/**
 * Recurring subscriptions entitled to access at a point in time (UTC),
 * aligned with api subscription.model recurringRowIsEntitled semantics.
 *
 * Counts are **one per user**: among recurring rows with
 * `COALESCE(start_at, created_at) <= as_of`, only each user's latest row
 * (by `created_at DESC`, `subscription_id DESC`) is considered, then the same
 * status / period-end rules as before apply.
 */
class SubscriptionsAnalyticsModel {
  /**
   * Recurring subscriptions whose entitlement window overlaps [rangeStartUtc, rangeEndUtc]
   * (UTC). Uses the same status / period-end rules as {@link countRecurringEntitledAt}, but
   * counts rows active for any instant in the range instead of only at range end.
   * One row per user (latest recurring row as of range end).
   */
  static async countRecurringEntitledOverlappingRange(rangeStartUtcDatetime, rangeEndUtcDatetime) {
    const aliveCsv = ALIVE_STATUSES.map((s) => `'${s}'`).join(', ');
    const query = `
      WITH ranked AS (
        SELECT s.*,
          ROW_NUMBER() OVER (
            PARTITION BY s.user_id
            ORDER BY s.created_at DESC, s.subscription_id DESC
          ) AS rn
        FROM subscriptions s
        WHERE s.payment_type = 'recurring'
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

  static async countRecurringEntitledAt(asOfUtcDatetime) {
    const aliveCsv = ALIVE_STATUSES.map((s) => `'${s}'`).join(', ');
    const query = `
      WITH ranked AS (
        SELECT s.*,
          ROW_NUMBER() OVER (
            PARTITION BY s.user_id
            ORDER BY s.created_at DESC, s.subscription_id DESC
          ) AS rn
        FROM subscriptions s
        WHERE s.payment_type = 'recurring'
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
   * For each calendar day in the supplied list, count **users** whose latest
   * recurring subscription (as of that instant) was entitled — same rules as
   * {@link countRecurringEntitledAt} but computes all snapshots in one query.
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
            ORDER BY s.created_at DESC, s.subscription_id DESC
          ) AS rn
        FROM days d
        INNER JOIN subscriptions s
          ON s.payment_type = 'recurring'
          AND COALESCE(s.start_at, s.created_at) <= d.day_utc
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
   * Resolve `payment_plans` metadata for subscription rows keyed by `provider_plan_id`
   * (numeric pp_id or store SKU via `payment_gateway_plans`).
   * @param {unknown[]} providerPlanIds
   * @param {{ useMaster?: boolean }} [options] use primary DB for reads (admin / read-your-writes)
   * @returns {Promise<Map<string, { plan_name: string|null, billing_interval: string|null, plan_type: string|null }>>}
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
        'SELECT pp_id, plan_name, billing_interval, plan_type FROM payment_plans WHERE pp_id IN (?)',
        [numericIds]
      );
      for (const r of rows || []) {
        map.set(String(r.pp_id), {
          plan_name: r.plan_name != null ? String(r.plan_name) : null,
          billing_interval: r.billing_interval != null ? String(r.billing_interval) : null,
          plan_type: r.plan_type != null ? String(r.plan_type) : null
        });
      }
    }

    const stringSkus = unique.filter((id) => !/^\d+$/.test(id));
    if (stringSkus.length) {
      const rows = await runQuery(
        `SELECT pp.plan_name, pp.billing_interval, pp.plan_type,
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
            plan_type: hit.plan_type != null ? String(hit.plan_type) : null
          });
        }
      }
    }

    return map;
  }

  /**
   * Admin Purchases tab: subscriptions whose purchase/start instant falls in the UTC window
   * derived from [startCal, endCal] in `tz`, with optional filters and pagination.
   *
   * @param {Object} opts
   * @param {string} opts.startCal YYYY-MM-DD
   * @param {string} opts.endCal YYYY-MM-DD
   * @param {string} opts.tz IANA
   * @param {string} [opts.clientPlatform] '' | 'ios' | 'android' | 'web'
   * @param {number|null} [opts.paymentPlanId] internal `payment_plans.pp_id` — matches numeric `provider_plan_id` or gateway SKU rows for that plan
   * @param {number} opts.limit
   * @param {number} opts.offset
   * @param {boolean} [opts.useMaster] read from primary (avoids replica lag after admin writes / seeds)
   * @returns {Promise<{ rows: object[], total: number }>}
   */
  static async listUserSubscriptionsForAdminRange(opts) {
    const { startCal, endCal, tz, clientPlatform = '', paymentPlanId = null, limit, offset, useMaster = false } = opts;
    const runQuery = useMaster ? MysqlQueryRunner.runQueryInMaster : MysqlQueryRunner.runQueryInSlave;
    const { rangeStartUtc, rangeEndUtc } = SubscriptionsAnalyticsModel.utcRangeForCalendarDays(startCal, endCal, tz);

    const pf = clientPlatform != null ? String(clientPlatform).trim().toLowerCase() : '';

    const platformClause =
      pf === ''
        ? { sql: '', params: [] }
        : { sql: ' AND linked_client_platform = ? ', params: [pf] };

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

    const innerParams = [rangeStartUtc, rangeEndUtc, ...planClause.params];

    const baseInner = `
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
        ) AS linked_order_gateway
      FROM subscriptions s
      INNER JOIN user u ON u.user_id = s.user_id
      WHERE (u.DELETED_AT IS NULL)
        AND COALESCE(s.start_at, s.created_at) >= ?
        AND COALESCE(s.start_at, s.created_at) <= ?
        ${planClause.sql}
    `;

    const countQuery = `
      SELECT COUNT(*) AS cnt
      FROM (
        ${baseInner}
      ) t
      WHERE 1=1
      ${platformClause.sql}
    `;

    const countRows = await runQuery(countQuery, [...innerParams, ...platformClause.params]);
    const total = Number(countRows[0]?.cnt || 0) || 0;

    const listQuery = `
      SELECT * FROM (
        ${baseInner}
      ) t
      WHERE 1=1
      ${platformClause.sql}
      ORDER BY t.purchase_or_start_at DESC, t.subscription_id DESC
      LIMIT ? OFFSET ?
    `;

    const rows = await runQuery(listQuery, [...innerParams, ...platformClause.params, limit, offset]);

    return { rows: rows || [], total };
  }
}

module.exports = SubscriptionsAnalyticsModel;

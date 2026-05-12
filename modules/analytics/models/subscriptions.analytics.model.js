'use strict';

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
}

module.exports = SubscriptionsAnalyticsModel;

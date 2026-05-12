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
 */
class SubscriptionsAnalyticsModel {
  /**
   * Recurring subscriptions whose entitlement window overlaps [rangeStartUtc, rangeEndUtc]
   * (UTC). Uses the same status / period-end rules as {@link countRecurringEntitledAt}, but
   * counts rows active for any instant in the range instead of only at range end.
   */
  static async countRecurringEntitledOverlappingRange(rangeStartUtcDatetime, rangeEndUtcDatetime) {
    const aliveCsv = ALIVE_STATUSES.map((s) => `'${s}'`).join(', ');
    const query = `
      SELECT COUNT(*) AS cnt
      FROM subscriptions
      WHERE payment_type = 'recurring'
        AND COALESCE(start_at, created_at) <= ?
        AND (
          COALESCE(current_period_end, renews_at, end_at) IS NULL
          OR COALESCE(current_period_end, renews_at, end_at) > ?
        )
        AND (
          status IN (${aliveCsv})
          OR (
            status = 'cancelled'
            AND COALESCE(current_period_end, renews_at, end_at) IS NOT NULL
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
      SELECT COUNT(*) AS cnt
      FROM subscriptions
      WHERE payment_type = 'recurring'
        AND COALESCE(start_at, created_at) <= ?
        AND (
          (
            status IN (${aliveCsv})
            AND (
              COALESCE(current_period_end, renews_at, end_at) IS NULL
              OR COALESCE(current_period_end, renews_at, end_at) > ?
            )
          )
          OR (
            status = 'cancelled'
            AND COALESCE(current_period_end, renews_at, end_at) IS NOT NULL
            AND COALESCE(current_period_end, renews_at, end_at) > ?
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
   * For each calendar day in the supplied list, count recurring subscriptions
   * that were entitled at that day's "as-of" UTC instant (typically end-of-day
   * in the client timezone). Uses the same status / period-end rules as
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

    // LEFT JOIN over a synthetic `days` relation so empty days come back as 0.
    const query = `
      SELECT d.day_utc, COUNT(s.subscription_id) AS cnt
      FROM (${dayUnion}) AS d
      LEFT JOIN subscriptions s
        ON s.payment_type = 'recurring'
        AND COALESCE(s.start_at, s.created_at) <= d.day_utc
        AND (
          (
            s.status IN (${aliveCsv})
            AND (
              COALESCE(s.current_period_end, s.renews_at, s.end_at) IS NULL
              OR COALESCE(s.current_period_end, s.renews_at, s.end_at) > d.day_utc
            )
          )
          OR (
            s.status = 'cancelled'
            AND COALESCE(s.current_period_end, s.renews_at, s.end_at) IS NOT NULL
            AND COALESCE(s.current_period_end, s.renews_at, s.end_at) > d.day_utc
          )
        )
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

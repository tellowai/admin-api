'use strict';

const moment = require('moment-timezone');

class TimezoneService {
  /**
   * Convert client timezone dates to UTC for database queries
   * @param {string} startDate - Start date in client timezone
   * @param {string} endDate - End date in client timezone
   * @param {string} startTime - Start time (optional)
   * @param {string} endTime - End time (optional)
   * @param {string} timezone - Client timezone (defaults to UTC)
   * @returns {Object} - Object with UTC converted dates and times
   */
  static convertToUTC(startDate, endDate, startTime = null, endTime = null, timezone = 'UTC') {
    const tz = timezone || 'UTC';
    
    // Convert to string and extract date part
    let startDateStr, endDateStr;
    
    if (startDate instanceof Date) {
      startDateStr = startDate.toISOString().split('T')[0];
    } else if (typeof startDate === 'string') {
      startDateStr = startDate.includes('T') ? startDate.split('T')[0] : startDate;
    } else {
      startDateStr = String(startDate);
    }
    
    if (endDate instanceof Date) {
      endDateStr = endDate.toISOString().split('T')[0];
    } else if (typeof endDate === 'string') {
      endDateStr = endDate.includes('T') ? endDate.split('T')[0] : endDate;
    } else {
      endDateStr = String(endDate);
    }
    
    // If dates already have timezone info (like 2025-09-12T00:00:00.000 or 2025-09-12T00:00:00Z), 
    // they're already in the correct timezone context, so use them as-is
    // Convert Date objects to ISO strings for checking
    let startDateStrForCheck = startDate;
    let endDateStrForCheck = endDate;
    
    if (startDate instanceof Date) {
      startDateStrForCheck = startDate.toISOString();
    }
    if (endDate instanceof Date) {
      endDateStrForCheck = endDate.toISOString();
    }
    
    if (typeof startDateStrForCheck === 'string') {
      if (startDateStrForCheck.includes('T') && (startDateStrForCheck.includes('.') || startDateStrForCheck.includes('Z'))) {
        // Calendar date from the browser + client tz — do not parse bare ISO as server-local.
        const startYmd = this.toCalendarYmd(startDateStrForCheck);
        const endYmd = this.toCalendarYmd(endDateStrForCheck);
        return this.convertToUTC(startYmd, endYmd, startTime, endTime, timezone);
      }
    }
    
    // Default times if not provided
    const defaultStartTime = startTime || '00:00:00';
    const defaultEndTime = endTime || '23:59:59';
    
    // Create moment objects in client timezone
    const startDateTime = moment.tz(`${startDateStr} ${defaultStartTime}`, tz);
    const endDateTime = moment.tz(`${endDateStr} ${defaultEndTime}`, tz);
    
    // Convert to UTC
    const utcStartDate = startDateTime.utc().format('YYYY-MM-DD');
    const utcEndDate = endDateTime.utc().format('YYYY-MM-DD');
    const utcStartTime = startDateTime.utc().format('HH:mm:ss');
    const utcEndTime = endDateTime.utc().format('HH:mm:ss');
    
    return {
      start_date: utcStartDate,
      end_date: utcEndDate,
      start_time: utcStartTime,
      end_time: utcEndTime
    };
  }

  /**
   * Convert UTC dates back to client timezone for response
   * @param {Array} data - Array of data objects with date fields
   * @param {string} timezone - Client timezone (defaults to UTC)
   * @returns {Array} - Data with dates converted to client timezone
   */
  static convertFromUTC(data, timezone = 'UTC') {
    if (!data || !Array.isArray(data)) {
      return data;
    }

    const tz = timezone || 'UTC';
    
    return data.map(item => {
      const convertedItem = { ...item };
      
      // Convert date field if it exists
      if (item.date) {
        const utcDate = moment.utc(item.date);
        convertedItem.date = utcDate.tz(tz).format('YYYY-MM-DD');
      }
      
      // Convert day field if it exists
      if (item.day) {
        const utcDay = moment.utc(item.day);
        convertedItem.day = utcDay.tz(tz).format('YYYY-MM-DD');
      }
      
      // Convert month field if it exists
      if (item.month) {
        const utcMonth = moment.utc(item.month);
        convertedItem.month = utcMonth.tz(tz).format('YYYY-MM');
      }
      
      // Convert generated_at field if it exists
      if (item.generated_at) {
        const utcGeneratedAt = moment.utc(item.generated_at);
        convertedItem.generated_at = utcGeneratedAt.tz(tz).format('YYYY-MM-DD HH:mm:ss');
      }
      
      return convertedItem;
    });
  }

  /**
   * Convert UTC date range back to client timezone for summary responses
   * @param {string} startDate - UTC start date
   * @param {string} endDate - UTC end date
   * @param {string} timezone - Client timezone (defaults to UTC)
   * @returns {Object} - Object with dates converted to client timezone
   */
  static convertDateRangeFromUTC(startDate, endDate, timezone = 'UTC') {
    const tz = timezone || 'UTC';
    
    // Convert to string and extract date part
    let startDateStr, endDateStr;
    
    if (startDate instanceof Date) {
      startDateStr = startDate.toISOString().split('T')[0];
    } else if (typeof startDate === 'string') {
      startDateStr = startDate.includes('T') ? startDate.split('T')[0] : startDate;
    } else {
      startDateStr = String(startDate);
    }
    
    if (endDate instanceof Date) {
      endDateStr = endDate.toISOString().split('T')[0];
    } else if (typeof endDate === 'string') {
      endDateStr = endDate.includes('T') ? endDate.split('T')[0] : endDate;
    } else {
      endDateStr = String(endDate);
    }
    
    const utcStartDate = moment.utc(startDateStr);
    const utcEndDate = moment.utc(endDateStr);
    
    return {
      start_date: utcStartDate.tz(tz).format('YYYY-MM-DD'),
      end_date: utcEndDate.tz(tz).format('YYYY-MM-DD')
    };
  }

  /**
   * Raw HTTP `req.query` value: always a string in Express, may be an array for duplicate keys.
   * @param {string|string[]|undefined} value
   * @returns {string}
   */
  static _firstQueryString(value) {
    if (value == null || value === '') return '';
    if (Array.isArray(value)) {
      return value[0] == null || value[0] === '' ? '' : String(value[0]).trim();
    }
    return String(value).trim();
  }

  /**
   * Client calendar YYYY-MM-DD from the *exact* string the browser sent (same as orders `toCalendarDate`):
   * never use a Joi-coerced `Date` here — the server TZ would not match the admin UI.
   *
   * @param {string|string[]|undefined} queryParam
   * @returns {string}
   */
  static toCalendarYmdFromHttpParam(queryParam) {
    const s = this._firstQueryString(queryParam);
    if (!s) return '';
    return s.includes('T') ? s.split('T')[0] : s.slice(0, 10);
  }

  /**
   * YYYY-MM-DD from query string or Date (same idea as `toCalendarDate` in orders analytics).
   * @param {string|Date} input
   * @returns {string}
   */
  static toCalendarYmd(input) {
    if (input == null || input === '') return '';
    if (input instanceof Date) {
      return moment(input).format('YYYY-MM-DD');
    }
    const s = String(input).trim();
    if (!s) return '';
    return s.includes('T') ? s.split('T')[0] : s.slice(0, 10);
  }

  /**
   * Calendar YYYY-MM-DD for admin range pickers. Prefer the date portion of ISO strings (before Joi → Date),
   * so `2026-05-26T23:59:59.999` stays May 26 in every timezone.
   *
   * @param {string|Date} input
   * @param {string} [tzRaw] IANA — used only when `input` is a `Date` (fallback)
   * @returns {string}
   */
  static toCalendarYmdInTz(input, tzRaw) {
    if (input == null || input === '') return '';
    if (typeof input === 'string') {
      const s = input.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      if (s.includes('T')) return s.split('T')[0];
      return (s.split(' ')[0] || s).slice(0, 10);
    }
    if (input instanceof Date && !Number.isNaN(input.getTime())) {
      const z = moment.tz.zone(this.normalizeTimezoneAlias(tzRaw)) != null
        ? this.normalizeTimezoneAlias(tzRaw)
        : 'UTC';
      return moment(input).tz(z).format('YYYY-MM-DD');
    }
    return '';
  }

  /**
   * One row per inclusive calendar day in [startYmd, endYmd] with UTC bounds for overlap queries.
   *
   * @param {string} startYmd
   * @param {string} endYmd
   * @param {string} tzRaw
   * @returns {{ date: string, dayStartUtc: string, dayEndUtc: string }[]}
   */
  static calendarDaysWithUtcBounds(startYmd, endYmd, tzRaw) {
    const z = moment.tz.zone(this.normalizeTimezoneAlias(tzRaw)) != null
      ? this.normalizeTimezoneAlias(tzRaw)
      : 'UTC';
    const out = [];
    for (
      let cursor = moment.tz(startYmd, z).startOf('day');
      !cursor.isAfter(moment.tz(endYmd, z).startOf('day'));
      cursor = cursor.clone().add(1, 'day')
    ) {
      const date = cursor.format('YYYY-MM-DD');
      out.push({
        date,
        dayStartUtc: moment.tz(`${date} 00:00:00.000`, z).utc().format('YYYY-MM-DD HH:mm:ss.SSS'),
        dayEndUtc: moment.tz(`${date} 23:59:59.999`, z).utc().format('YYYY-MM-DD HH:mm:ss.SSS')
      });
    }
    return out;
  }

  /** IANA normalisation (e.g. Asia/Calcutta → Asia/Kolkata; matches orders SQL expectations). */
  static normalizeTimezoneAlias(tz) {
    const ALIASES = { 'Asia/Calcutta': 'Asia/Kolkata' };
    const t = tz && String(tz).trim() ? String(tz).trim() : 'UTC';
    return ALIASES[t] || t;
  }

  /**
   * Inclusive UTC bounds for a client "calendar" date range, for `analytics_events_raw.timestamp`
   * (DateTime64 UTC) — same semantics as orders admin `utcRangeForCalendarDays` / MySQL funnel.
   *
   * @param {string} startYmd YYYY-MM-DD (client calendar, first day)
   * @param {string} endYmd YYYY-MM-DD (inclusive, last day)
   * @param {string} tz IANA
   * @returns {{ rangeStartUtc: string, rangeEndUtc: string }} e.g. for toDateTime64('...', 3, 'UTC')
   */
  static utcRangeForClientCalendar(startYmd, endYmd, tzRaw) {
    const t = this.normalizeTimezoneAlias(tzRaw);
    const z = moment.tz.zone(t) != null ? t : 'UTC';
    const rangeStartUtc = moment.tz(`${startYmd} 00:00:00.000`, z).utc().format('YYYY-MM-DD HH:mm:ss.SSS');
    const rangeEndUtc = moment.tz(`${endYmd} 23:59:59.999`, z).utc().format('YYYY-MM-DD HH:mm:ss.SSS');
    return { rangeStartUtc, rangeEndUtc };
  }

  /**
   * Validate timezone string
   * @param {string} timezone - Timezone string to validate
   * @returns {boolean} - True if valid timezone
   */
  static isValidTimezone(timezone) {
    if (!timezone) return true; // UTC is default
    return moment.tz.zone(timezone) !== null;
  }

  /**
   * Get default timezone (UTC)
   * @returns {string} - Default timezone
   */
  static getDefaultTimezone() {
    return 'UTC';
  }

  /**
   * Inclusive client-calendar window as UTC bounds (00:00:00.000 first day → 23:59:59.999 last day in `tz`).
   * Use for template analytics + any admin range that must match Generations list semantics.
   */
  static fullClientDayUtcFilters(startCal, endCal, tzRaw) {
    const start = this.toCalendarYmd(startCal);
    const end = this.toCalendarYmd(endCal);
    const tz = this.normalizeTimezoneAlias(tzRaw || this.getDefaultTimezone());
    const utc = this.convertToUTC(start, end, '00:00:00', '23:59:59', tz);
    const { rangeStartUtc, rangeEndUtc } = this.utcRangeForClientCalendar(start, end, tz);
    return {
      ...utc,
      client_calendar_start: start,
      client_calendar_end: end,
      tz,
      rangeStartUtc,
      rangeEndUtc
    };
  }

  /**
   * Parse template analytics query: calendar YYYY-MM-DD from raw HTTP params + full client days in `tz`.
   */
  static templateAnalyticsFiltersFromRequest(req) {
    const queryParams = req.validatedQuery || {};
    const tz = queryParams.tz || this.getDefaultTimezone();
    const startCal = this.toCalendarYmdFromHttpParam(req.query.start_date);
    const endCal = this.toCalendarYmdFromHttpParam(req.query.end_date);
    return this.fullClientDayUtcFilters(startCal, endCal, tz);
  }
}

module.exports = TimezoneService;

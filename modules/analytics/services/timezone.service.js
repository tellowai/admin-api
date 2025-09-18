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
        // This is already a timestamp with timezone info, use it directly
        const startMoment = moment(startDateStrForCheck);
        const endMoment = moment(endDateStrForCheck);
        
        return {
          start_date: startMoment.format('YYYY-MM-DD'),
          end_date: endMoment.format('YYYY-MM-DD'),
          start_time: startMoment.format('HH:mm:ss'),
          end_time: endMoment.format('HH:mm:ss')
        };
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
}

module.exports = TimezoneService;

'use strict';

const { slaveClickhouse } = require('../../../config/lib/clickhouse');
const ANALYTICS_CONSTANTS = require('../constants/analytics.constants');

class AnalyticsModel {
  static buildDateTimeConditions(start_date, end_date, start_time, end_time) {
    // Format dates for ClickHouse date comparison (YYYY-MM-DD format)
    const startDateFormatted = new Date(start_date).toISOString().split('T')[0];
    const endDateFormatted = new Date(end_date).toISOString().split('T')[0];
    
    // Set default times if not provided
    const defaultStartTime = start_time || '00:00:00';
    const defaultEndTime = end_time || '23:59:59';
    
    // Build datetime conditions
    const startDateTime = `'${startDateFormatted} ${defaultStartTime}'`;
    const endDateTime = `'${endDateFormatted} ${defaultEndTime}'`;
    
    return [`generated_at >= ${startDateTime}`, `generated_at <= ${endDateTime}`];
  }

  static async queryCharacterCreations(filters) {
    const { start_date, end_date, start_time, end_time, gender, character_id, user_id } = filters;

    // Build datetime conditions with time support
    let whereConditions = this.buildDateTimeConditions(start_date, end_date, start_time, end_time);

    if (gender) {
      whereConditions.push(`gender = '${gender}'`);
    }

    if (character_id) {
      whereConditions.push(`character_id = '${character_id}'`);
    }

    if (user_id) {
      whereConditions.push(`user_id = '${user_id}'`);
    }

    const query = `
      SELECT 
        toDate(generated_at) as date,
        count(*) as count
      FROM ${ANALYTICS_CONSTANTS.TABLES.CHARACTER_CREATIONS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY toDate(generated_at)
      ORDER BY date ASC
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryCharacterTrainings(filters) {
    const { start_date, end_date, start_time, end_time, gender, character_id, user_id } = filters;

    // Build datetime conditions with time support
    let whereConditions = this.buildDateTimeConditions(start_date, end_date, start_time, end_time);

    if (gender) {
      whereConditions.push(`gender = '${gender}'`);
    }

    if (character_id) {
      whereConditions.push(`character_id = '${character_id}'`);
    }

    if (user_id) {
      whereConditions.push(`user_id = '${user_id}'`);
    }

    const query = `
      SELECT 
        toDate(generated_at) as date,
        count(*) as count
      FROM ${ANALYTICS_CONSTANTS.TABLES.CHARACTER_TRAININGS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY toDate(generated_at)
      ORDER BY date ASC
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryTemplateViews(filters) {
    const {
      start_date,
      end_date,
      start_time,
      end_time,
      output_type,
      aspect_ratio,
      orientation,
      generation_type,
      template_id,
      user_id
    } = filters;

    // Build datetime conditions with time support
    let whereConditions = this.buildDateTimeConditions(start_date, end_date, start_time, end_time);

    if (output_type) {
      whereConditions.push(`output_type = '${output_type}'`);
    }

    if (aspect_ratio) {
      whereConditions.push(`aspect_ratio = '${aspect_ratio}'`);
    }

    if (orientation) {
      whereConditions.push(`orientation = '${orientation}'`);
    }

    if (generation_type) {
      whereConditions.push(`generation_type = '${generation_type}'`);
    }

    if (template_id) {
      whereConditions.push(`template_id = '${template_id}'`);
    }

    if (user_id) {
      whereConditions.push(`user_id = '${user_id}'`);
    }

    const query = `
      SELECT 
        toDate(generated_at) as date,
        count(*) as count
      FROM ${ANALYTICS_CONSTANTS.TABLES.TEMPLATE_VIEWS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY toDate(generated_at)
      ORDER BY date ASC
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async queryTemplateTries(filters) {
    const {
      start_date,
      end_date,
      start_time,
      end_time,
      output_type,
      aspect_ratio,
      orientation,
      generation_type,
      template_id,
      user_id
    } = filters;

    // Build datetime conditions with time support
    let whereConditions = this.buildDateTimeConditions(start_date, end_date, start_time, end_time);

    if (output_type) {
      whereConditions.push(`output_type = '${output_type}'`);
    }

    if (aspect_ratio) {
      whereConditions.push(`aspect_ratio = '${aspect_ratio}'`);
    }

    if (orientation) {
      whereConditions.push(`orientation = '${orientation}'`);
    }

    if (generation_type) {
      whereConditions.push(`generation_type = '${generation_type}'`);
    }

    if (template_id) {
      whereConditions.push(`template_id = '${template_id}'`);
    }

    if (user_id) {
      whereConditions.push(`user_id = '${user_id}'`);
    }

    const query = `
      SELECT 
        toDate(generated_at) as date,
        count(*) as count
      FROM ${ANALYTICS_CONSTANTS.TABLES.TEMPLATE_TRIES}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY toDate(generated_at)
      ORDER BY date ASC
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async getCharacterCreationsCount(filters) {
    const { start_date, end_date, start_time, end_time, gender, character_id, user_id } = filters;

    // Build datetime conditions with time support
    let whereConditions = this.buildDateTimeConditions(start_date, end_date, start_time, end_time);

    if (gender) {
      whereConditions.push(`gender = '${gender}'`);
    }

    if (character_id) {
      whereConditions.push(`character_id = '${character_id}'`);
    }

    if (user_id) {
      whereConditions.push(`user_id = '${user_id}'`);
    }

    const query = `
      SELECT COUNT(*) as total_count
      FROM ${ANALYTICS_CONSTANTS.TABLES.CHARACTER_CREATIONS}
      WHERE ${whereConditions.join(' AND ')}
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0]?.total_count || 0;
  }

  static async getCharacterTrainingsCount(filters) {
    const { start_date, end_date, start_time, end_time, gender, character_id, user_id } = filters;

    // Build datetime conditions with time support
    let whereConditions = this.buildDateTimeConditions(start_date, end_date, start_time, end_time);

    if (gender) {
      whereConditions.push(`gender = '${gender}'`);
    }

    if (character_id) {
      whereConditions.push(`character_id = '${character_id}'`);
    }

    if (user_id) {
      whereConditions.push(`user_id = '${user_id}'`);
    }

    const query = `
      SELECT COUNT(*) as total_count
      FROM ${ANALYTICS_CONSTANTS.TABLES.CHARACTER_TRAININGS}
      WHERE ${whereConditions.join(' AND ')}
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0]?.total_count || 0;
  }

  static async getTemplateViewsCount(filters) {
    const {
      start_date,
      end_date,
      start_time,
      end_time,
      output_type,
      aspect_ratio,
      orientation,
      generation_type,
      template_id,
      user_id
    } = filters;

    // Build datetime conditions with time support
    let whereConditions = this.buildDateTimeConditions(start_date, end_date, start_time, end_time);

    if (output_type) {
      whereConditions.push(`output_type = '${output_type}'`);
    }

    if (aspect_ratio) {
      whereConditions.push(`aspect_ratio = '${aspect_ratio}'`);
    }

    if (orientation) {
      whereConditions.push(`orientation = '${orientation}'`);
    }

    if (generation_type) {
      whereConditions.push(`generation_type = '${generation_type}'`);
    }

    if (template_id) {
      whereConditions.push(`template_id = '${template_id}'`);
    }

    if (user_id) {
      whereConditions.push(`user_id = '${user_id}'`);
    }

    const query = `
      SELECT COUNT(*) as total_count
      FROM ${ANALYTICS_CONSTANTS.TABLES.TEMPLATE_VIEWS}
      WHERE ${whereConditions.join(' AND ')}
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0]?.total_count || 0;
  }

  static async getTemplateTriesCount(filters) {
    const {
      start_date,
      end_date,
      start_time,
      end_time,
      output_type,
      aspect_ratio,
      orientation,
      generation_type,
      template_id,
      user_id
    } = filters;

    // Build datetime conditions with time support
    let whereConditions = this.buildDateTimeConditions(start_date, end_date, start_time, end_time);

    if (output_type) {
      whereConditions.push(`output_type = '${output_type}'`);
    }

    if (aspect_ratio) {
      whereConditions.push(`aspect_ratio = '${aspect_ratio}'`);
    }

    if (orientation) {
      whereConditions.push(`orientation = '${orientation}'`);
    }

    if (generation_type) {
      whereConditions.push(`generation_type = '${generation_type}'`);
    }

    if (template_id) {
      whereConditions.push(`template_id = '${template_id}'`);
    }

    if (user_id) {
      whereConditions.push(`user_id = '${user_id}'`);
    }

    const query = `
      SELECT COUNT(*) as total_count
      FROM ${ANALYTICS_CONSTANTS.TABLES.TEMPLATE_TRIES}
      WHERE ${whereConditions.join(' AND ')}
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0]?.total_count || 0;
  }

  static async queryTemplateDownloads(filters) {
    const {
      start_date,
      end_date,
      start_time,
      end_time,
      output_type,
      aspect_ratio,
      orientation,
      generation_type,
      template_id,
      user_id
    } = filters;

    // Build datetime conditions with time support
    let whereConditions = this.buildDateTimeConditions(start_date, end_date, start_time, end_time);

    if (output_type) {
      whereConditions.push(`output_type = '${output_type}'`);
    }

    if (aspect_ratio) {
      whereConditions.push(`aspect_ratio = '${aspect_ratio}'`);
    }

    if (orientation) {
      whereConditions.push(`orientation = '${orientation}'`);
    }

    if (generation_type) {
      whereConditions.push(`generation_type = '${generation_type}'`);
    }

    if (template_id) {
      whereConditions.push(`template_id = '${template_id}'`);
    }

    if (user_id) {
      whereConditions.push(`user_id = '${user_id}'`);
    }

    const query = `
      SELECT 
        toDate(generated_at) as date,
        count(*) as count
      FROM ${ANALYTICS_CONSTANTS.TABLES.TEMPLATE_DOWNLOADS}
      WHERE ${whereConditions.join(' AND ')}
      GROUP BY toDate(generated_at)
      ORDER BY date ASC
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data || [];
  }

  static async getTemplateDownloadsCount(filters) {
    const {
      start_date,
      end_date,
      start_time,
      end_time,
      output_type,
      aspect_ratio,
      orientation,
      generation_type,
      template_id,
      user_id
    } = filters;

    // Build datetime conditions with time support
    let whereConditions = this.buildDateTimeConditions(start_date, end_date, start_time, end_time);

    if (output_type) {
      whereConditions.push(`output_type = '${output_type}'`);
    }

    if (aspect_ratio) {
      whereConditions.push(`aspect_ratio = '${aspect_ratio}'`);
    }

    if (orientation) {
      whereConditions.push(`orientation = '${orientation}'`);
    }

    if (generation_type) {
      whereConditions.push(`generation_type = '${generation_type}'`);
    }

    if (template_id) {
      whereConditions.push(`template_id = '${template_id}'`);
    }

    if (user_id) {
      whereConditions.push(`user_id = '${user_id}'`);
    }

    const query = `
      SELECT COUNT(*) as total_count
      FROM ${ANALYTICS_CONSTANTS.TABLES.TEMPLATE_DOWNLOADS}
      WHERE ${whereConditions.join(' AND ')}
    `;

    const result = await slaveClickhouse.querying(query, { dataObjects: true });
    return result.data?.[0]?.total_count || 0;
  }
}

module.exports = AnalyticsModel;

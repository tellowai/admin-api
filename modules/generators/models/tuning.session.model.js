'use strict';

const MysqlQueryRunner = require('../../core/models/mysql.promise.model');
const {
  runQueryInMaster: RunCHQueryInMaster,
  runQueryingInSlave: RunCHQueryingInSlave
} = require('../../core/models/clickhouse.promise.model');


class TuningSessionModel {
  static async insertMediaFile(mediaDataArray) {
    const query = `
      INSERT INTO media_files (
        media_id,
        project_id,
        character_id,
        user_id,
        cf_r2_key,
        cf_r2_url,
        media_type,
        tag
      ) VALUES ?
    `;

    const params = mediaDataArray.map(mediaData => [
      mediaData.media_id,
      mediaData.project_id,
      mediaData.character_id, 
      mediaData.user_id,
      mediaData.cf_r2_key,
      mediaData.cf_r2_url,
      mediaData.media_type,
      mediaData.tag
    ]);

    return await MysqlQueryRunner.runQueryInMaster(query, [params]);
  }

  static async getTuningSessionEvents(tuningSessionId, eventType = null) {
    let query = `
      SELECT * FROM tuning_session_events 
      WHERE tuning_session_id = '${tuningSessionId}'
    `;

    if (eventType) {
      query += ` AND event_type = '${eventType}'`;
    }

    return await RunCHQueryingInSlave(query);
  }

  static async getTuningSessionEventsByProjectId(projectId, eventType = null) {
    let query = `
      SELECT * FROM tuning_session_events 
      WHERE project_id = '${projectId}'
    `;

    if (eventType) {
      query += ` AND event_type = '${eventType}'`;
    }

    return await RunCHQueryingInSlave(query);
  }

  static async getTuningSessionEventsByCharacterId(userCharacterId, eventType = null) {
    let query = `
      SELECT * FROM tuning_session_events 
      WHERE user_character_id = '${userCharacterId}'
    `;

    if (eventType) {
      query += ` AND event_type = '${eventType}'`;
    }

    return await RunCHQueryingInSlave(query);
  }

  static async insertTuningSessionEvent(eventData) {
    const columns = Object.keys(eventData[0]).join(', ');
    const values = eventData.map(data => 
      Object.values(data).map(value => 
        typeof value === 'string' ? `'${value}'` : `'${value}'`
      ).join(', ')
    ).join('), (');
    
    const query = `
      INSERT INTO tuning_session_events
      (${columns})
      VALUES
      (${values})
    `;

    return await RunCHQueryInMaster(query);
  }
}

module.exports = TuningSessionModel;
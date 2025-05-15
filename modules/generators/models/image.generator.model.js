'use strict';

const MysqlQueryRunner = require('../../core/models/mysql.promise.model');
const {
  runQueryInMaster: RunCHQueryInMaster,
  runQueryingInSlave: RunCHQueryingInSlave
} = require('../../core/models/clickhouse.promise.model');


class ImageGeneratorModel {
  static async insertImageGenerations(generationData) {
    // Ensure generationData is an array
    const dataArray = Array.isArray(generationData) ? generationData : [generationData];

    if (dataArray.length === 0) {
      return;
    }

    // Get columns from first data object
    const columns = Object.keys(dataArray[0]).join(', ');

    // Map values from data objects
    const values = dataArray.map(data => {
      const vals = Object.values(data).map(val => {
        if (typeof val === 'object') {
          return `'${JSON.stringify(val)}'`;
        }
        return `'${val}'`;
      });
      return vals.join(', ');
    }).join('), (');

    const query = `
      INSERT INTO image_generations
      (${columns})
      VALUES
      (${values})
    `;

    return await RunCHQueryInMaster(query);
  }

  static async getLatestGenerationEvent(generationId) {
    const query = `
      SELECT *
      FROM resource_generation_events
      WHERE resource_generation_id = '${generationId}'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await RunCHQueryingInSlave(query);
    return result[0];
  }

  static async insertResourceGenerationEvent(eventData) {
    // Ensure eventData is an array
    const dataArray = Array.isArray(eventData) ? eventData : [eventData];

    if (dataArray.length === 0) {
      return;
    }

    // Get columns from first data object
    const columns = Object.keys(dataArray[0]).join(', ');

    // Map values from data objects
    const values = dataArray.map(data => {
      const vals = Object.values(data).map(val => {
        if (typeof val === 'object') {
          // Properly escape JSON string for ClickHouse
          return `'${JSON.stringify(val).replace(/'/g, "''").replace(/\\/g, "\\\\")}'`;
        }
        // Escape string values
        return `'${String(val).replace(/'/g, "''")}'`;
      });
      return vals.join(', ');
    }).join('), (');

    const query = `
      INSERT INTO resource_generation_events
      (${columns})
      VALUES
      (${values})
    `;

    return await RunCHQueryInMaster(query);
  }

  static async verifyGenerationOwnership(generationId, userId) {
    const query = `
      SELECT 1
      FROM resource_generation_events
      WHERE resource_generation_id = '${generationId}'
      AND additional_data LIKE '%"user_id":"${userId}"%'
      LIMIT 1
    `;

    const result = await RunCHQueryingInSlave(query);
    return result.length > 0;
  }
}

module.exports = ImageGeneratorModel;
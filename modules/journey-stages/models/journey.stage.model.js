'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { v7: uuidv7 } = require('uuid');

exports.listByNicheId = async function (nicheId) {
  const query = `
    SELECT stage_id, niche_id, slug, name, sequence_order, description, status, created_at, updated_at
    FROM journey_stages
    WHERE niche_id = ?
    AND archived_at IS NULL
    ORDER BY sequence_order ASC
  `;
  return mysqlQueryRunner.runQueryInSlave(query, [nicheId]);
};

exports.listAllActive = async function () {
  const query = `
    SELECT stage_id, niche_id, slug, name, sequence_order, description, status
    FROM journey_stages
    WHERE status = 'active'
    AND archived_at IS NULL
    ORDER BY niche_id, sequence_order
  `;
  return mysqlQueryRunner.runQueryInSlave(query, []);
};

exports.getById = async function (stageId) {
  const query = `
    SELECT stage_id, niche_id, slug, name, sequence_order, description, status, additional_data
    FROM journey_stages
    WHERE stage_id = ?
    LIMIT 1
  `;
  const [row] = await mysqlQueryRunner.runQueryInSlave(query, [stageId]);
  return row || null;
};

exports.insert = async function (payload) {
  const stageId = payload.stage_id || uuidv7();
  const query = `
    INSERT INTO journey_stages (stage_id, niche_id, slug, name, sequence_order, description, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  await mysqlQueryRunner.runQueryInMaster(query, [
    stageId,
    payload.niche_id,
    payload.slug,
    payload.name,
    payload.sequence_order,
    payload.description || null,
    payload.status || 'active'
  ]);
  return stageId;
};

exports.update = async function (stageId, fields) {
  const sets = [];
  const params = [];
  const allowed = ['slug', 'name', 'sequence_order', 'description', 'status'];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(fields[key]);
    }
  }
  if (!sets.length) return;
  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(stageId);
  const query = `UPDATE journey_stages SET ${sets.join(', ')} WHERE stage_id = ?`;
  return mysqlQueryRunner.runQueryInMaster(query, params);
};

exports.archive = async function (stageId) {
  const query = `
    UPDATE journey_stages
    SET status = 'archived', archived_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP
    WHERE stage_id = ?
  `;
  return mysqlQueryRunner.runQueryInMaster(query, [stageId]);
};

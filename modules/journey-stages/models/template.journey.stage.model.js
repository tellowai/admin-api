'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

exports.listStageIdsForTemplate = async function (templateId) {
  const query = `SELECT stage_id FROM template_journey_stages WHERE template_id = ?`;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [templateId]);
  return rows.map((r) => r.stage_id);
};

exports.listTemplateIdsForStage = async function (stageId) {
  const query = `SELECT template_id FROM template_journey_stages WHERE stage_id = ?`;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [stageId]);
  return rows.map((r) => r.template_id);
};

exports.replaceTemplateStages = async function (templateId, stageIds) {
  await mysqlQueryRunner.runQueryInMaster(
    `DELETE FROM template_journey_stages WHERE template_id = ?`,
    [templateId]
  );
  if (!stageIds?.length) return;
  const values = stageIds.map(() => '(?, ?)').join(', ');
  const params = [];
  for (const stageId of stageIds) {
    params.push(templateId, stageId);
  }
  const query = `INSERT INTO template_journey_stages (template_id, stage_id) VALUES ${values}`;
  return mysqlQueryRunner.runQueryInMaster(query, params);
};

/**
 * Assign a single stage to many templates. Batched into two set-based queries
 * (one DELETE … IN, one multi-row INSERT) per chunk — never one query per template.
 */
exports.bulkAssignStage = async function (templateIds, stageId) {
  if (!templateIds?.length || !stageId) return;

  const uniqueIds = [...new Set(templateIds.filter(Boolean))];
  if (!uniqueIds.length) return;

  const CHUNK = 100;
  for (let i = 0; i < uniqueIds.length; i += CHUNK) {
    const chunk = uniqueIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');

    await mysqlQueryRunner.runQueryInMaster(
      `DELETE FROM template_journey_stages WHERE template_id IN (${placeholders})`,
      chunk
    );

    const values = chunk.map(() => '(?, ?)').join(', ');
    const params = [];
    for (const templateId of chunk) {
      params.push(templateId, stageId);
    }
    await mysqlQueryRunner.runQueryInMaster(
      `INSERT INTO template_journey_stages (template_id, stage_id) VALUES ${values}`,
      params
    );
  }
};

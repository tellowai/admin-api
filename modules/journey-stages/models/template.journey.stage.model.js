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

exports.bulkAssignStage = async function (templateIds, stageId) {
  if (!templateIds?.length || !stageId) return;
  for (const templateId of templateIds) {
    await exports.replaceTemplateStages(templateId, [stageId]);
  }
};

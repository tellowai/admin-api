'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { v7: uuidv7 } = require('uuid');

/**
 * Bulk create scenes within a transaction
 */
exports.createTemplateScenesInTransaction = async function (connection, templateId, scenes) {
  if (!scenes || !Array.isArray(scenes) || scenes.length === 0) return [];

  const createdScenes = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const sceneId = scene.scene_id || uuidv7();
    const sceneOrder = scene.scene_order || (i + 1);
    const sceneName = scene.scene_name || null;

    const query = `
      INSERT INTO template_scenes (scene_id, template_id, scene_name, scene_order)
      VALUES (?, ?, ?, ?)
    `;

    await connection.query(query, [sceneId, templateId, sceneName, sceneOrder]);

    createdScenes.push({
      scene_id: sceneId,
      template_id: templateId,
      scene_name: sceneName,
      scene_order: sceneOrder,
      layers: scene.layers || []
    });
  }

  return createdScenes;
};

/**
 * Get scenes by template ID
 */
exports.getScenesByTemplateId = async function (templateId) {
  const query = `
    SELECT 
      scene_id,
      template_id,
      scene_name,
      scene_order,
      created_at,
      updated_at
    FROM template_scenes
    WHERE template_id = ?
    ORDER BY scene_order ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, [templateId]);
};

/**
 * Delete scenes for a template within transaction
 */
exports.deleteTemplateScenesInTransaction = async function (connection, templateId) {
  const query = `DELETE FROM template_scenes WHERE template_id = ?`;
  await connection.query(query, [templateId]);
};

/**
 * Get scenes by multiple template IDs
 */
exports.getScenesByTemplateIds = async function (templateIds) {
  if (!templateIds || templateIds.length === 0) return [];

  const placeholders = templateIds.map(() => '?').join(',');
  const query = `
    SELECT 
      scene_id,
      template_id,
      scene_name,
      scene_order,
      created_at,
      updated_at
    FROM template_scenes
    WHERE template_id IN (${placeholders})
    ORDER BY scene_order ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, templateIds);
};

'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { v7: uuidv7 } = require('uuid');

/**
 * Bulk create layers for scenes within a transaction
 */
exports.createTemplateLayersInTransaction = async function (connection, createdScenes) {
  if (!createdScenes || !Array.isArray(createdScenes) || createdScenes.length === 0) return;

  for (const scene of createdScenes) {
    const layers = scene.layers;
    if (!layers || !Array.isArray(layers) || layers.length === 0) continue;

    for (const layer of layers) {
      const layerId = layer.layer_id || uuidv7();
      const zIndex = layer.z_index || 1;
      const layerName = layer.layer_name || layer.type || 'Unnamed Layer';
      const layerType = layer.type || layer.layer_type;

      const assetBucket = layer.asset_bucket || layer.bucket || null;
      const assetKey = layer.asset_key || layer.key || null;

      const layerConfig = layer.config || layer.layer_config || null;
      const layerConfigJson = layerConfig ? JSON.stringify(layerConfig) : null;

      const query = `
        INSERT INTO template_layers 
          (layer_id, scene_id, layer_name, layer_type, z_index, asset_bucket, asset_key, layer_config)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await connection.query(query, [
        layerId,
        scene.scene_id,
        layerName,
        layerType,
        zIndex,
        assetBucket,
        assetKey,
        layerConfigJson
      ]);
    }
  }
};

/**
 * Get layers by multiple scene IDs
 */
exports.getLayersBySceneIds = async function (sceneIds) {
  if (!sceneIds || sceneIds.length === 0) return [];

  const placeholders = sceneIds.map(() => '?').join(',');
  const query = `
    SELECT 
      layer_id,
      scene_id,
      layer_name,
      layer_type,
      z_index,
      asset_bucket,
      asset_key,
      layer_config,
      created_at,
      updated_at
    FROM template_layers
    WHERE scene_id IN (${placeholders})
    ORDER BY z_index ASC
  `;

  return await mysqlQueryRunner.runQueryInSlave(query, sceneIds);
};

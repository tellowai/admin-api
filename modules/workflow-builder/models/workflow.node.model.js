'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * Get nodes by multiple workflow IDs (batch, no joins).
 * @param {number[]} workflowIds - wf_id list
 * @returns {Promise<Array>} Flat list of nodes, each with wf_id
 */
exports.getNodesByWorkflowIds = async function (workflowIds) {
  if (!workflowIds || workflowIds.length === 0) return [];
  const unique = [...new Set(workflowIds)].filter(id => id != null);
  const placeholders = unique.map(() => '?').join(',');
  const query = `
    SELECT 
      wfn_id,
      uuid,
      wf_id,
      type,
      amr_id,
      system_node_type,
      position_x as x,
      position_y as y,
      width,
      height,
      config_values,
      ui_metadata
    FROM workflow_nodes
    WHERE wf_id IN (${placeholders})
  `;
  const results = await mysqlQueryRunner.runQueryInSlave(query, unique);
  return results.map(node => {
    if (node.config_values && typeof node.config_values === 'string') {
      try { node.config_values = JSON.parse(node.config_values); } catch (e) { }
    }
    if (node.ui_metadata && typeof node.ui_metadata === 'string') {
      try { node.ui_metadata = JSON.parse(node.ui_metadata); } catch (e) { }
    }
    return {
      ...node,
      position: { x: node.x, y: node.y }
    };
  });
};

/**
 * Get nodes by workflow ID
 */
exports.getNodesByWorkflowId = async function (workflowId) {
  const query = `
    SELECT 
      wfn_id,
      uuid,
      wf_id,
      type,
      amr_id,
      system_node_type,
      position_x as x,
      position_y as y,
      width,
      height,
      config_values,
      ui_metadata
    FROM workflow_nodes 
    WHERE wf_id = ?
  `;

  const results = await mysqlQueryRunner.runQueryInSlave(query, [workflowId]);

  return results.map(node => {
    // Parse JSON fields
    if (node.config_values && typeof node.config_values === 'string') {
      try { node.config_values = JSON.parse(node.config_values); } catch (e) { }
    }
    if (node.ui_metadata && typeof node.ui_metadata === 'string') {
      try { node.ui_metadata = JSON.parse(node.ui_metadata); } catch (e) { }
    }

    // Structure for frontend
    return {
      ...node,
      position: { x: node.x, y: node.y }
    };
  });
};

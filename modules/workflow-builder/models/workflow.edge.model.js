'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');

/**
 * Get edges by workflow ID
 */
exports.getEdgesByWorkflowId = async function (workflowId) {
  const query = `
    SELECT 
      wfe_id,
      uuid,
      wf_id,
      source_wfn_id,
      source_socket_name as sourceHandle,
      target_wfn_id,
      target_socket_name as targetHandle,
      edge_type as type,
      animated
    FROM workflow_edges
    WHERE wf_id = ?
  `;

  const results = await mysqlQueryRunner.runQueryInSlave(query, [workflowId]);

  return results.map(edge => ({
    ...edge,
    animated: !!edge.animated // Convert to boolean
  }));
};

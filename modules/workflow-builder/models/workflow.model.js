'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { v4: uuidv4 } = require('uuid');

/**
 * List workflows for a user with pagination
 */
exports.listWorkflows = async function (userId, searchParams = {}, paginationParams = null) {
  let query = `
    SELECT 
      wf_id,
      uuid,
      user_id,
      name,
      description,
      status,
      is_template,
      change_hash,
      created_at,
      updated_at,
      auto_saved_at,
      published_at
    FROM workflows 
    WHERE user_id = ? AND archived_at IS NULL
  `;

  const queryParams = [userId];

  if (searchParams.status) {
    query += ` AND status = ?`;
    queryParams.push(searchParams.status);
  }

  if (searchParams.search) {
    query += ` AND (name LIKE ? OR description LIKE ?)`;
    queryParams.push(`%${searchParams.search}%`, `%${searchParams.search}%`);
  }

  // Add pagination
  if (paginationParams) {
    query += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
    queryParams.push(paginationParams.limit, paginationParams.offset);
  }

  const workflows = await mysqlQueryRunner.runQueryInSlave(query, queryParams);

  return workflows;
};

/**
 * Get single workflow by ID
 */
exports.getWorkflowById = async function (workflowId, userId = null) {
  let query = `
    SELECT * FROM workflows 
    WHERE wf_id = ? AND archived_at IS NULL
  `;
  const params = [workflowId];

  if (userId) {
    query += ` AND user_id = ?`;
    params.push(userId);
  }

  const results = await mysqlQueryRunner.runQueryInSlave(query, params);

  if (results.length === 0) return null;

  const workflow = results[0];
  // Parse JSON fields
  if (workflow.viewport_state) {
    workflow.viewport_state = typeof workflow.viewport_state === 'string'
      ? JSON.parse(workflow.viewport_state)
      : workflow.viewport_state;
  }

  return workflow;
};

/**
 * Create new workflow
 */
exports.createWorkflow = async function (workflowData) {
  const query = `
    INSERT INTO workflows (uuid, user_id, name, description, status, created_at)
    VALUES (?, ?, ?, ?, ?, NOW())
  `;

  const result = await mysqlQueryRunner.runQueryInMaster(query, [
    workflowData.uuid,
    workflowData.user_id,
    workflowData.name,
    workflowData.description || null,
    workflowData.status || 'draft'
  ]);

  return result;
};

/**
 * Save workflow nodes and edges (transaction)
 */
exports.saveWorkflowData = async function (workflowId, data) {
  const connection = await mysqlQueryRunner.getConnectionFromMaster();

  try {
    await connection.beginTransaction();

    // Update workflow metadata
    await connection.query(
      `UPDATE workflows SET 
        viewport_state = ?,
        change_hash = ?,
        auto_saved_at = NOW(),
        updated_at = NOW()
       WHERE wf_id = ?`,
      [JSON.stringify(data.viewport), data.change_hash, workflowId]
    );

    // Delete existing nodes and edges (cascade will handle edges)
    // Note: If using ON DELETE CASCADE in DB, deleting nodes should be enough for edges connected to them.
    // However, the plan code deletes from workflow_nodes explicitly.
    await connection.query(`DELETE FROM workflow_nodes WHERE wf_id = ?`, [workflowId]);

    // Insert new nodes
    if (data.nodes && data.nodes.length > 0) {
      const nodeValues = data.nodes.map(node => [
        node.uuid || uuidv4(),
        workflowId,
        node.type,
        node.amr_id || null,
        node.system_node_type || null,
        node.position?.x || 0,
        node.position?.y || 0,
        node.width || 250,
        node.height || 150,
        JSON.stringify(node.config_values || {}),
        JSON.stringify(node.ui_metadata || {})
      ]);

      await connection.query(
        `INSERT INTO workflow_nodes 
          (uuid, wf_id, type, amr_id, system_node_type, position_x, position_y, width, height, config_values, ui_metadata)
         VALUES ?`,
        [nodeValues]
      );
    }

    // Insert new edges
    if (data.edges && data.edges.length > 0) {
      // First get the node IDs by UUID
      const [insertedNodes] = await connection.query(
        `SELECT wfn_id, uuid FROM workflow_nodes WHERE wf_id = ?`,
        [workflowId]
      );
      const nodeUuidToId = Object.fromEntries(insertedNodes.map(n => [n.uuid, n.wfn_id]));

      const edgeValues = data.edges.map(edge => [
        edge.uuid || uuidv4(),
        workflowId,
        nodeUuidToId[edge.source] || edge.source_wfn_id,
        edge.sourceHandle || edge.source_socket_name,
        nodeUuidToId[edge.target] || edge.target_wfn_id,
        edge.targetHandle || edge.target_socket_name,
        edge.type || 'default',
        edge.animated || false
      ]);

      await connection.query(
        `INSERT INTO workflow_edges 
          (uuid, wf_id, source_wfn_id, source_socket_name, target_wfn_id, target_socket_name, edge_type, animated)
         VALUES ?`,
        [edgeValues]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

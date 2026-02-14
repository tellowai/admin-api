'use strict';

const mysqlQueryRunner = require('../../core/models/mysql.promise.model');
const { v4: uuidv4, v7: uuidv7 } = require('uuid');
const AiModelRegistryModel = require('./ai-model-registry.model');

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
 * Bulk: which wf_ids exist in workflows (archived_at IS NULL). Single query.
 * @param {number[]} wfIds - workflow IDs
 * @returns {Promise<Set<number>>} Set of wf_id that exist
 */
exports.getWorkflowIdsThatExist = async function (wfIds) {
  if (!wfIds || wfIds.length === 0) return new Set();

  const unique = [...new Set(wfIds)].filter(id => id != null);
  const query = `SELECT wf_id FROM workflows WHERE wf_id IN (?) AND archived_at IS NULL`;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [unique]);
  return new Set(rows.map(r => r.wf_id));
};

/**
 * Bulk: node count per wf_id. Single query.
 * @param {number[]} wfIds - workflow IDs
 * @returns {Promise<Map<number, number>>} Map of wf_id -> node count
 */
exports.getWorkflowNodeCountsByWfIds = async function (wfIds) {
  if (!wfIds || wfIds.length === 0) return new Map();

  const unique = [...new Set(wfIds)].filter(id => id != null);
  const query = `
    SELECT wf_id, COUNT(*) AS cnt
    FROM workflow_nodes
    WHERE wf_id IN (?)
    GROUP BY wf_id
  `;
  const rows = await mysqlQueryRunner.runQueryInSlave(query, [unique]);
  const map = new Map();
  rows.forEach(r => map.set(r.wf_id, Number(r.cnt) || 0));
  return map;
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

    // Insert new nodes (support both API shape and React Flow shape: node.data.config_values, node.id)
    if (data.nodes && data.nodes.length > 0) {

      // Load system node definitions dynamically to support all active types
      // Note: listSystemNodeDefinitions is async, so we must await it.
      // Since we are inside an async function saveWorkflowData, this is fine.
      const systemNodes = await AiModelRegistryModel.listSystemNodeDefinitions(null, 1000, 0);

      // Create set of valid slugs
      const VALID_SYSTEM_SLUGS = new Set(systemNodes.map(n => n.type_slug));
      VALID_SYSTEM_SLUGS.add('START');

      const nodeValues = data.nodes.map(node => {
        // Prefer React Flow shape; Joi validator can default node.config_values to {} and hide data.config_values
        const configValues = node.data?.config_values ?? node.config_values ?? {};
        const uiMeta = node.ui_metadata ?? (node.data && (() => {
          const { config_values: _cv, ...rest } = node.data;
          return rest;
        })()) ?? {};

        let dbType = node.type;
        let dbAmrId = node.amr_id ?? null;
        let dbSystemNodeType = node.system_node_type ?? null;

        const typeToCheck = node.system_node_type || node.type;

        // Priority 1: Explicit system_node object in data (most reliable if present)
        if (node.data?.system_node?.type_slug && VALID_SYSTEM_SLUGS.has(node.data.system_node.type_slug)) {
          dbType = 'SYSTEM_NODE';
          dbSystemNodeType = node.data.system_node.type_slug;
          dbAmrId = null;
        }
        // Priority 2: Matches a valid known slug or is the legacy "USER_INPUT" type
        else if (VALID_SYSTEM_SLUGS.has(typeToCheck) || typeToCheck === 'USER_INPUT') {
          dbType = 'SYSTEM_NODE';

          if (typeToCheck === 'USER_INPUT') {
            // Dynamic fallback: Use amr_id to find the actual slug from DB definitions (e.g. USER_INPUT_IMAGE)
            if (dbAmrId) {
              const matchingDef = systemNodes.find(n => n.wsnd_id === dbAmrId);
              if (matchingDef) {
                dbSystemNodeType = matchingDef.type_slug;
              } else {
                dbSystemNodeType = 'USER_INPUT_IMAGE'; // Ultimate fallback
              }
            } else {
              dbSystemNodeType = 'USER_INPUT_IMAGE';
            }
          } else {
            dbSystemNodeType = typeToCheck;
          }
          dbAmrId = null;
        }

        return [
          node.uuid ?? node.id ?? uuidv4(),
          workflowId,
          dbType,
          dbAmrId,
          dbSystemNodeType,
          node.position?.x ?? node.computedPosition?.x ?? 0,
          node.position?.y ?? node.computedPosition?.y ?? 0,
          node.width ?? node.dimensions?.width ?? 250,
          node.height ?? node.dimensions?.height ?? 150,
          JSON.stringify(configValues),
          JSON.stringify(uiMeta)
        ];
      });

      await connection.query(
        `INSERT INTO workflow_nodes 
          (uuid, wf_id, type, amr_id, system_node_type, position_x, position_y, width, height, config_values, ui_metadata)
         VALUES ?`,
        [nodeValues]
      );
    }

    // Insert new edges (only run SELECT when we have edges to insert)
    if (data.edges && data.edges.length > 0) {
      const insertedNodes = await connection.query(
        `SELECT wfn_id, uuid FROM workflow_nodes WHERE wf_id = ?`,
        [workflowId]
      );
      const nodeUuidToId = Object.fromEntries(Array.isArray(insertedNodes) ? insertedNodes.map(n => [n.uuid, n.wfn_id]) : []);

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

/**
 * Copy a workflow row (full insert) within a transaction. Used for template copy.
 * @param {Object} connection - DB connection (from getConnectionFromMaster)
 * @param {Object} workflowRow - Full workflow row from SELECT * (wf_id will be omitted)
 * @returns {Promise<number>} New wf_id (insertId)
 */
exports.insertWorkflowRowInTransaction = async function (connection, workflowRow) {
  const newUuid = uuidv7();
  const viewportState = workflowRow.viewport_state != null
    ? (typeof workflowRow.viewport_state === 'string' ? workflowRow.viewport_state : JSON.stringify(workflowRow.viewport_state))
    : null;
  const inputManifestSummary = workflowRow.input_manifest_summary != null
    ? (typeof workflowRow.input_manifest_summary === 'string' ? workflowRow.input_manifest_summary : JSON.stringify(workflowRow.input_manifest_summary))
    : null;

  const query = `
    INSERT INTO workflows (
      uuid, user_id, name, description, status, is_template,
      input_manifest_summary, viewport_state, change_hash,
      created_at, updated_at, auto_saved_at, published_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?)
  `;
  const result = await connection.query(query, [
    newUuid,
    workflowRow.user_id,
    workflowRow.name,
    workflowRow.description ?? null,
    workflowRow.status ?? 'draft',
    workflowRow.is_template ?? 0,
    inputManifestSummary,
    viewportState,
    workflowRow.change_hash ?? null,
    workflowRow.auto_saved_at ?? null,
    workflowRow.published_at ?? null,
    workflowRow.archived_at ?? null
  ]);
  return result.insertId;
};

/**
 * Copy workflow nodes within a transaction. Returns map oldWfnId -> newWfnId.
 * @param {Object} connection - DB connection
 * @param {number} newWfId - New workflow ID
 * @param {Array} nodes - Rows from workflow_nodes (with wfn_id, uuid, type, amr_id, etc.)
 * @returns {Promise<Map<number, number>>} Map of old wfn_id -> new wfn_id
 */
exports.insertWorkflowNodesInTransaction = async function (connection, newWfId, nodes) {
  if (!nodes || nodes.length === 0) return { idMap: new Map(), uuidMap: new Map() };

  // Generate new UUIDs for all nodes first so we can map them
  const nodeUuidMap = new Map(); // oldUuid -> newUuid

  const nodeValues = nodes.map(node => {
    const newUuid = uuidv7();
    nodeUuidMap.set(node.uuid, newUuid);

    return [
      newUuid,
      newWfId,
      node.type,
      node.amr_id ?? null,
      node.system_node_type ?? null,
      node.position_x ?? node.x ?? 0,
      node.position_y ?? node.y ?? 0,
      node.width ?? 250,
      node.height ?? 150,
      typeof node.config_values === 'string' ? node.config_values : JSON.stringify(node.config_values || {}),
      typeof node.ui_metadata === 'string' ? node.ui_metadata : JSON.stringify(node.ui_metadata || {})
    ];
  });

  const result = await connection.query(
    `INSERT INTO workflow_nodes 
      (uuid, wf_id, type, amr_id, system_node_type, position_x, position_y, width, height, config_values, ui_metadata)
     VALUES ?`,
    [nodeValues]
  );

  const insertId = result.insertId;
  const oldToNew = new Map();
  nodes.forEach((node, i) => {
    oldToNew.set(node.wfn_id, insertId + i);
  });

  return { idMap: oldToNew, uuidMap: nodeUuidMap };
};

/**
 * Copy workflow edges within a transaction.
 * @param {Object} connection - DB connection
 * @param {number} newWfId - New workflow ID
 * @param {Array} edges - Rows from workflow_edges
 * @param {Map<number, number>} wfnIdMap - Map old wfn_id -> new wfn_id
 */
exports.insertWorkflowEdgesInTransaction = async function (connection, newWfId, edges, wfnIdMap) {
  if (!edges || edges.length === 0) return;

  const edgeValues = edges.map(edge => [
    uuidv7(),
    newWfId,
    wfnIdMap.get(edge.source_wfn_id) ?? edge.source_wfn_id,
    edge.source_socket_name ?? edge.sourceHandle ?? '',
    wfnIdMap.get(edge.target_wfn_id) ?? edge.target_wfn_id,
    edge.target_socket_name ?? edge.targetHandle ?? '',
    edge.edge_type ?? edge.type ?? 'default',
    edge.animated ? 1 : 0,
    edge.style_config != null ? (typeof edge.style_config === 'string' ? edge.style_config : JSON.stringify(edge.style_config)) : null
  ]);

  await connection.query(
    `INSERT INTO workflow_edges 
      (uuid, wf_id, source_wfn_id, source_socket_name, target_wfn_id, target_socket_name, edge_type, animated, style_config)
     VALUES ?`,
    [edgeValues]
  );
};

/**
 * Get workflow ID linked to a template_ai_clip (tac_id). Returns null if no workflow linked.
 * Simple query, no joins.
 */
exports.getWfIdByTacId = async function (tacId) {
  const query = `
    SELECT wf_id FROM template_ai_clips
    WHERE tac_id = ? AND deleted_at IS NULL
  `;
  const results = await mysqlQueryRunner.runQueryInSlave(query, [tacId]);
  if (results.length === 0 || results[0].wf_id == null) return null;
  return results[0].wf_id;
};

/**
 * Get one row for clip (tac_id): wf_id, template_id, clip_index. Single query, no joins.
 * Use for ensureWorkflowForTacId to avoid 2 round trips (getWfId + getTacClipInfo).
 */
exports.getTacRow = async function (tacId) {
  const query = `
    SELECT wf_id, template_id, clip_index FROM template_ai_clips
    WHERE tac_id = ? AND deleted_at IS NULL
  `;
  const results = await mysqlQueryRunner.runQueryInSlave(query, [tacId]);
  return results.length > 0 ? results[0] : null;
};

/**
 * Link a workflow to a template_ai_clip (tac_id).
 */
exports.setWfIdForTacId = async function (tacId, wfId) {
  const query = `UPDATE template_ai_clips SET wf_id = ?, updated_at = NOW() WHERE tac_id = ?`;
  await mysqlQueryRunner.runQueryInMaster(query, [wfId, tacId]);
};

/**
 * Get or create workflow for a clip (tac_id). Returns wf_id.
 * Single tac query (wf_id + template_id + clip_index), then create+link if needed. No extra round trip for clip info.
 */
exports.ensureWorkflowForTacId = async function (tacId, userId) {
  const row = await exports.getTacRow(tacId);
  if (!row) return null;
  if (row.wf_id != null) return row.wf_id;

  const name = `template_${row.template_id}_clip_${row.clip_index}`;
  const workflowData = {
    uuid: uuidv7(),
    user_id: userId,
    name,
    description: null,
    status: 'draft'
  };
  const result = await exports.createWorkflow(workflowData);
  const newWfId = result.insertId;
  await exports.setWfIdForTacId(tacId, newWfId);
  return newWfId;
};

'use strict';

/**
 * Service to handle workflow compilation/publishing
 */

exports.compileWorkflow = async function (workflowId, nodes, edges) {
  // 1. Identify all USER_INPUT nodes
  const userInputNodes = nodes.filter(n => n.type === 'USER_INPUT');

  // 2. Generate input manifest
  const inputManifest = userInputNodes.map(node => {
    const config = node.config_values || {};
    return {
      variable_key: config.variable_key || `input_${node.uuid.substring(0, 8)}`,
      label: config.label || node.data?.label || 'Input',
      type: config.input_type || 'Text',
      is_required: config.is_required !== false,
      default_value: config.default_value,
      ui_metadata: node.ui_metadata
    };
  });

  // 3. TODO: Validate connections/cycles
  // For now, assume validity if saved

  return {
    inputManifest
  };
};

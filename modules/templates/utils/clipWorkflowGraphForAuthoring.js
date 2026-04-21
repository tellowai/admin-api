'use strict';

const TemplateModel = require('../models/template.model');
const WorkflowNodeModel = require('../../workflow-builder/models/workflow.node.model');

/**
 * Load Vue-flow-shaped `{ clip_index, nodes }[]` for template field projection / authoring.
 * `clip_index` matches `template_ai_clips.clip_index` so bindings can reference the same values as workflows.
 *
 * @param {string} templateId
 * @returns {Promise<Array<{ clip_index: number, nodes: object[] }>>}
 */
async function loadClipWorkflowsUiGraphForProjection(templateId) {
  const clips = (await TemplateModel.getTemplateAiClips(templateId)) || [];
  clips.sort((a, b) => Number(a.clip_index) - Number(b.clip_index));
  const wfIds = [...new Set(clips.map((c) => Number(c.wf_id)).filter((id) => !Number.isNaN(id) && id > 0))];
  if (wfIds.length === 0) {
    return clips.map((c) => ({ clip_index: Number(c.clip_index), nodes: [] }));
  }

  const rows = await WorkflowNodeModel.getNodesByWorkflowIds(wfIds);
  const byWfId = new Map();
  for (const n of rows || []) {
    const wid = Number(n.wf_id);
    if (!byWfId.has(wid)) byWfId.set(wid, []);
    const cv = n.config_values && typeof n.config_values === 'object' ? n.config_values : {};
    const t = String(n.system_node_type || n.type || '');
    byWfId.get(wid).push({
      type: t,
      type_slug: t,
      label: cv.label,
      data: {
        label: cv.label,
        variable_key: cv.variable_key,
        inputs: {
          variable_key: cv.variable_key
        },
        config_values: cv
      }
    });
  }

  return clips.map((c) => ({
    clip_index: Number(c.clip_index),
    nodes: byWfId.get(Number(c.wf_id)) || []
  }));
}

module.exports = {
  loadClipWorkflowsUiGraphForProjection
};

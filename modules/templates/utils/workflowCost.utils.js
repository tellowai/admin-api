'use strict';

/**
 * Workflow cost calculation – same algorithm as admin-ui workflowCost.js.
 * Uses canonical pricing_config only.
 *
 * Canonical pricing_config shape:
 *   pricing_config: {
 *     input: {
 *       text: { per_million_tokens: number },
 *       image: { first_megapixel: number, per_additional_megapixel: number },
 *       video: { per_second: number }
 *     },
 *     output: {
 *       image: { first_megapixel: number, per_additional_megapixel: number | null },
 *       video_with_audio?: { "720p": { per_second: number, per_segment: { "5s": number, "10s": number } } },
 *       video_without_audio?: { "720p": { per_second: number, per_segment: { "5s": number, "10s": number } } },
 *       text?: { per_million_tokens: number }
 *     }
 *   }
 */

const DEFAULTS = {
  input: {
    text: { per_million_tokens: 0 },
    image: { first_megapixel: 0, per_additional_megapixel: 0 },
    video: { per_second: 0 }
  },
  output: {
    image: { first_megapixel: 0.04, per_additional_megapixel: 0.04 },
    video: { per_second_720p: 0.05, per_5s_segment: 0.25 },
    text: { per_million_tokens: 0.01 }
  }
};

const ASSUMED_PER_RUN = {
  text_tokens_million: 0.001,
  image_megapixels: 1,
  video_seconds: 5
};

function getNumber(val) {
  if (val == null || val === '') return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function inputCostFromPricing(pc) {
  let cost = 0;
  const input = pc?.input;
  if (!input || typeof input !== 'object') return cost;
  if (input.text != null && typeof input.text === 'object') {
    cost += getNumber(input.text.per_million_tokens) * ASSUMED_PER_RUN.text_tokens_million;
  }
  if (input.image != null && typeof input.image === 'object') {
    const first = getNumber(input.image.first_megapixel);
    const extra = getNumber(input.image.per_additional_megapixel);
    cost += first + (ASSUMED_PER_RUN.image_megapixels > 1 ? extra * (ASSUMED_PER_RUN.image_megapixels - 1) : 0);
  }
  if (input.video != null && typeof input.video === 'object') {
    cost += getNumber(input.video.per_second) * ASSUMED_PER_RUN.video_seconds;
  }
  return cost;
}

function outputCostFromPricing(pc, outputTypes) {
  let cost = 0;
  const output = pc?.output;
  if (!output || typeof output !== 'object') return cost;

  const hasImage = (outputTypes || []).some(t => (t || '').toLowerCase() === 'image');
  const hasVideo = (outputTypes || []).some(t => (t || '').toLowerCase() === 'video');
  const hasText = (outputTypes || []).some(t => (t || '').toLowerCase() === 'text');

  if (hasImage && output.image != null && typeof output.image === 'object') {
    const img = output.image;
    const first = getNumber(img.first_megapixel);
    const perAdd = getNumber(img.per_additional_megapixel);
    cost += first;
    if (ASSUMED_PER_RUN.image_megapixels > 1) {
      cost += perAdd * (ASSUMED_PER_RUN.image_megapixels - 1);
    }
  }

  if (hasVideo) {
    const vid =
      (output.video_without_audio && typeof output.video_without_audio === 'object' && output.video_without_audio) ||
      (output.video_with_audio && typeof output.video_with_audio === 'object' && output.video_with_audio) ||
      null;
    if (vid) {
      const res = vid['720p'] || vid['1080p'] || vid['512p'] || vid['768p'] || vid['360p'] || vid['540p'];
      if (res && typeof res === 'object') {
        const seg = res.per_segment;
        const seg5 = seg && typeof seg === 'object' ? getNumber(seg['5s']) : 0;
        const perSec = getNumber(res.per_second);
        if (seg5 > 0) cost += seg5;
        else if (perSec > 0) cost += perSec * ASSUMED_PER_RUN.video_seconds;
      }
    }
  }

  if (hasText && output.text != null && typeof output.text === 'object') {
    cost += getNumber(output.text.per_million_tokens) * ASSUMED_PER_RUN.text_tokens_million;
  }

  return cost;
}

function outputCostFromDefaults(outputTypes) {
  let cost = 0;
  for (const t of outputTypes || []) {
    const type = (t || '').toLowerCase();
    if (type === 'image') cost += DEFAULTS.output.image.first_megapixel;
    else if (type === 'video') cost += DEFAULTS.output.video.per_5s_segment;
    else if (type === 'text') cost += DEFAULTS.output.text.per_million_tokens * ASSUMED_PER_RUN.text_tokens_million;
  }
  return cost;
}

function inputCostFromDefaults(inputTypes) {
  let cost = 0;
  for (const t of inputTypes || []) {
    const type = (t || '').toLowerCase();
    if (type === 'text') cost += DEFAULTS.input.text.per_million_tokens * ASSUMED_PER_RUN.text_tokens_million;
    else if (type === 'image') cost += DEFAULTS.input.image.first_megapixel;
    else if (type === 'video') cost += DEFAULTS.input.video.per_second * ASSUMED_PER_RUN.video_seconds;
  }
  return cost;
}

function hasUsablePricing(pc) {
  if (!pc || typeof pc !== 'object') return false;
  const hasInput = pc.input && typeof pc.input === 'object' && Object.keys(pc.input).length > 0;
  const hasOutput = pc.output && typeof pc.output === 'object' && Object.keys(pc.output).length > 0;
  return hasInput || hasOutput;
}

/**
 * Compute cost for a single AI_MODEL node.
 * @param {Object} node - { type, id?, data: { inputs?, outputs?, pricing? } }
 * @returns {{ costUsd: number, isEstimate: boolean }}
 */
function computeNodeCost(node) {
  if (!node || node.type !== 'AI_MODEL') return { costUsd: 0, isEstimate: false };

  const inputs = node.data?.inputs || [];
  const outputs = node.data?.outputs || [];
  const inputTypes = inputs.map(i => (i && i.type) ? i.type : (typeof i === 'string' ? i : null)).filter(Boolean);
  const outputTypes = outputs.map(o => (o && o.type) ? o.type : (typeof o === 'string' ? o : null)).filter(Boolean);

  const pricing = node.data?.pricing;
  const usePricing = hasUsablePricing(pricing);

  let inputCost = 0;
  let outputCost = 0;
  let usedFallback = false;

  if (usePricing) {
    inputCost = inputCostFromPricing(pricing);
    outputCost = outputCostFromPricing(pricing, outputTypes);
    if (outputTypes.length > 0 && outputCost === 0) {
      outputCost = outputCostFromDefaults(outputTypes);
      usedFallback = true;
    }
  } else {
    inputCost = inputCostFromDefaults(inputTypes);
    outputCost = outputCostFromDefaults(outputTypes);
    usedFallback = true;
  }

  const costUsd = inputCost + outputCost;
  return { costUsd, isEstimate: usedFallback };
}

/**
 * Compute total workflow cost from an array of nodes (same as admin-ui).
 * @param {Array<Object>} nodes - Array of nodes (only AI_MODEL contribute)
 * @returns {{ totalUsd: number, isEstimate: boolean, byNode: Object }}
 */
function computeWorkflowCost(nodes) {
  const byNode = {};
  let totalUsd = 0;
  let anyEstimate = false;

  (nodes || []).forEach(n => {
    const { costUsd, isEstimate } = computeNodeCost(n);
    if (n.id != null) {
      byNode[n.id] = { costUsd, isEstimate };
    }
    totalUsd += costUsd;
    if (isEstimate) anyEstimate = true;
  });

  return {
    totalUsd,
    isEstimate: anyEstimate,
    byNode
  };
}

/**
 * Normalize API model.costs to canonical pricing_config used by computeNodeCost.
 * API may have per_megapixel; canonical uses first_megapixel + per_additional_megapixel.
 */
function costsToCanonicalPricing(costs) {
  if (!costs || typeof costs !== 'object') return null;
  const input = costs.input && typeof costs.input === 'object' ? { ...costs.input } : {};
  const output = costs.output && typeof costs.output === 'object' ? { ...costs.output } : {};

  if (input.image && typeof input.image === 'object' && input.image.per_megapixel != null && input.image.first_megapixel == null) {
    const pm = getNumber(input.image.per_megapixel);
    input.image = { first_megapixel: pm, per_additional_megapixel: pm };
  }
  if (output.image && typeof output.image === 'object' && output.image.per_megapixel != null && output.image.first_megapixel == null) {
    const pm = getNumber(output.image.per_megapixel);
    output.image = { first_megapixel: pm, per_additional_megapixel: pm };
  }

  if (Object.keys(input).length === 0 && Object.keys(output).length === 0) return null;
  return { input, output };
}

/**
 * Extract unique model IDs from clips (from workflow steps with ai_model data).
 * @param {Array} clips - Template clips with workflow array
 * @returns {string[]}
 */
function extractModelIdsFromClips(clips) {
  const ids = new Set();
  if (!Array.isArray(clips)) return [];
  for (const clip of clips) {
    if (!clip || !Array.isArray(clip.workflow)) continue;
    for (const step of clip.workflow) {
      if (!step || !Array.isArray(step.data)) continue;
      for (const item of step.data) {
        if (item && item.type === 'ai_model' && item.value) {
          ids.add(String(item.value).trim());
        }
      }
    }
  }
  return [...ids];
}

/**
 * Infer output types from workflow_code when model has none.
 */
function inferOutputTypesFromWorkflowCode(workflowCode) {
  const code = (workflowCode || '').toLowerCase();
  if (code.includes('video') || code === 'generate_video' || code === 'multi_input_generate_video') return ['video'];
  if (code.includes('image') || code === 'generate_image' || code === 'image_generation' || code === 'image_editing' ||
      code === 'inpainting' || code === 'inpaint_one_character' || code === 'style_change_convert_image' || code === 'multi_image_editing') {
    return ['image'];
  }
  return ['image'];
}

/**
 * Build cost-calculation nodes from clips and a map of modelId -> model (with costs, input_types, output_types).
 * Models may come from AiModelModel.getAiModelsByIds; missing models use fallback (estimate).
 * @param {Array} clips - Template clips with workflow array
 * @param {Map<string, Object>} modelMap - model_id -> { costs, input_types, output_types }
 * @returns {Array<Object>} Nodes in shape expected by computeWorkflowCost
 */
function buildNodesFromClips(clips, modelMap) {
  const nodes = [];
  if (!Array.isArray(clips)) return nodes;

  for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
    const clip = clips[clipIndex];
    if (!clip || !Array.isArray(clip.workflow)) continue;

    for (let stepIndex = 0; stepIndex < clip.workflow.length; stepIndex++) {
      const step = clip.workflow[stepIndex];
      if (!step || !Array.isArray(step.data)) continue;

      let modelId = null;
      for (const item of step.data) {
        if (item && item.type === 'ai_model' && item.value) {
          modelId = String(item.value).trim();
          break;
        }
      }
      if (!modelId) continue;

      const model = modelMap ? modelMap.get(modelId) : null;
      const inputTypes = (model && model.input_types) ? (Array.isArray(model.input_types) ? model.input_types : []) : ['image', 'text'];
      let outputTypes = (model && model.output_types) ? (Array.isArray(model.output_types) ? model.output_types : []) : [];
      if (outputTypes.length === 0) {
        outputTypes = inferOutputTypesFromWorkflowCode(step.workflow_code);
      }

      let pricing = null;
      if (model && model.costs) {
        const raw = typeof model.costs === 'string' ? (() => { try { return JSON.parse(model.costs); } catch (_) { return null; } })() : model.costs;
        pricing = costsToCanonicalPricing(raw) || raw;
      }

      const nodeId = `clip-${clipIndex}-step-${stepIndex}`;
      nodes.push({
        type: 'AI_MODEL',
        id: nodeId,
        data: {
          inputs: inputTypes.map(t => ({ type: t })),
          outputs: outputTypes.map(t => ({ type: t })),
          pricing
        }
      });
    }
  }

  return nodes;
}

/**
 * Compute template cost in USD from clips using the same algorithm as admin-ui.
 * Fetches AI models by IDs found in clips; missing models contribute via fallback defaults.
 * @param {Array} clips - Template clips with workflow array
 * @param {Function} getModelsByIds - async (modelIds: string[]) => Promise<Array<{ model_id, costs, input_types, output_types }>>
 * @returns {Promise<number>} totalUsd
 */
async function computeTemplateCostFromClips(clips, getModelsByIds) {
  const modelIds = extractModelIdsFromClips(clips);
  if (modelIds.length === 0) {
    return 0;
  }

  const models = await getModelsByIds(modelIds);
  const modelMap = new Map();
  for (const m of models || []) {
    if (m && m.model_id) modelMap.set(String(m.model_id), m);
  }

  const nodes = buildNodesFromClips(clips, modelMap);
  const result = computeWorkflowCost(nodes);
  return result.totalUsd;
}

exports.computeWorkflowCost = computeWorkflowCost;
exports.computeNodeCost = computeNodeCost;
exports.buildNodesFromClips = buildNodesFromClips;
exports.extractModelIdsFromClips = extractModelIdsFromClips;
exports.computeTemplateCostFromClips = computeTemplateCostFromClips;
exports.costsToCanonicalPricing = costsToCanonicalPricing;
exports.DEFAULTS = DEFAULTS;
exports.ASSUMED_PER_RUN = ASSUMED_PER_RUN;

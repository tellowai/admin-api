'use strict';

let logger;
try {
  logger = require('../../../config/lib/logger');
} catch (e) {
  logger = { info: (...args) => console.log('[cost_in_dollars]', ...args), warn: (...args) => console.warn('[cost_in_dollars]', ...args) };
}

/**
 * Workflow cost calculation – same algorithm as admin-ui workflowCost.js.
 * Uses canonical pricing_config only.
 *
 * Canonical pricing_config shape (input/output used for pricing; capabilities.input_types / output_types for per-model image vs video):
 *   pricing_config: {
 *     input: { text?, image?, video? },
 *     output: {
 *       image?: { first_megapixel, per_additional_megapixel },
 *       video_with_audio?: { "720p": { per_second, per_segment: { "5s", "10s" } } },
 *       video_without_audio?: { "720p": { per_second, per_segment: { "5s", "10s" } } },
 *       text?: { per_million_tokens }
 *     },
 *     capabilities?: { input_types: string[], output_types: string[] }  // e.g. ["image"], ["video_with_audio"]
 *   }
 * Cost is computed for all clips and every AI_MODEL step in each clip (image and video models supported).
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
  const hasVideo = (outputTypes || []).some(t => {
    const s = (t || '').toLowerCase();
    return s === 'video' || s === 'video_with_audio' || s === 'video_without_audio';
  });
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
    // Use pricing key that matches actual output type: video_with_audio vs video_without_audio (not a single fallback)
    const types = (outputTypes || []).map(t => (t || '').toLowerCase());
    const useWithAudio = types.includes('video_with_audio');
    const useWithoutAudio = types.includes('video_without_audio');
    const useLegacyVideo = types.includes('video') && !useWithAudio && !useWithoutAudio;

    let vid = null;
    if (useWithAudio && output.video_with_audio && typeof output.video_with_audio === 'object') {
      vid = output.video_with_audio;
    } else if (useWithoutAudio && output.video_without_audio && typeof output.video_without_audio === 'object') {
      vid = output.video_without_audio;
    } else if (useLegacyVideo) {
      vid =
        (output.video_without_audio && typeof output.video_without_audio === 'object' && output.video_without_audio) ||
        (output.video_with_audio && typeof output.video_with_audio === 'object' && output.video_with_audio) ||
        null;
    }
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
 * Infer output types from pricing_config.output when capabilities.output_types is missing (e.g. unparsed registry JSON in prod).
 */
function inferOutputTypesFromPricing(pc) {
  if (!pc || typeof pc !== 'object' || !pc.output || typeof pc.output !== 'object') return [];
  const out = pc.output;
  const types = [];
  if (out.video_with_audio && typeof out.video_with_audio === 'object') types.push('video_with_audio');
  if (out.video_without_audio && typeof out.video_without_audio === 'object') types.push('video_without_audio');
  if (out.image && typeof out.image === 'object') types.push('image');
  if (out.text && typeof out.text === 'object') types.push('text');
  if (types.length === 0 && (out.video || out.video_seconds)) types.push('video');
  return types;
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
      if (outputTypes.length === 0 && model && model.costs) {
        const rawCosts = typeof model.costs === 'string' ? (() => { try { return JSON.parse(model.costs); } catch (_) { return null; } })() : model.costs;
        outputTypes = inferOutputTypesFromPricing(rawCosts);
      }
      if (outputTypes.length === 0) {
        outputTypes = inferOutputTypesFromWorkflowCode(step.workflow_code);
      }

      // When model supports both video_with_audio and video_without_audio, pick one based on step config (generate_audio)
      const hasBothVideo = outputTypes.some(t => (t || '').toLowerCase() === 'video_with_audio') &&
        outputTypes.some(t => (t || '').toLowerCase() === 'video_without_audio');
      if (hasBothVideo) {
        const config = step.config_values ?? step.config ?? {};
        const generateAudio = config.generate_audio !== false;
        outputTypes = outputTypes.filter(t => {
          const lower = (t || '').toLowerCase();
          if (lower === 'video_with_audio') return generateAudio;
          if (lower === 'video_without_audio') return !generateAudio;
          return true;
        });
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
 * @param {Object} [options] - { verbose: boolean } When true, logs each step (default true). When false, only logs final total.
 * @returns {Promise<number>} totalUsd
 */
async function computeTemplateCostFromClips(clips, getModelsByIds, options = {}) {
  const verbose = options.verbose !== false;
  const logPrefix = '[cost_in_dollars]';
  const log = (msg) => { logger.info(msg); };

  if (verbose) log(`${logPrefix} --- cost_in_dollars calculation started ---`);
  const modelIds = extractModelIdsFromClips(clips);
  if (verbose) log(`${logPrefix} Step 1: Extracted model IDs from clips → [${(modelIds || []).join(', ') || 'none'}]`);

  if (modelIds.length === 0) {
    if (verbose) log(`${logPrefix} Step 2: No AI model steps in clips. cost_in_dollars = 0`);
    return 0;
  }

  const models = await getModelsByIds(modelIds);
  const modelMap = new Map();
  for (const m of models || []) {
    if (m && m.model_id) modelMap.set(String(m.model_id), m);
  }
  if (verbose) log(`${logPrefix} Step 2: Fetched ${(models || []).length} model(s) by ID; ${modelIds.length - modelMap.size} missing (will use default pricing)`);

  const nodes = buildNodesFromClips(clips, modelMap);
  if (verbose) log(`${logPrefix} Step 3: Built ${nodes.length} cost node(s) from clips (each node = one AI_MODEL step)`);

  const result = computeWorkflowCost(nodes);

  const totalUsd = result.totalUsd;
  const rounded = Number(Number(totalUsd).toFixed(4));

  if (verbose && nodes.length > 0) {
    // Group by clip: node id = "clip-{i}-step-{j}"
    const byClip = new Map();
    for (const n of nodes) {
      const m = n.id.match(/^clip-(\d+)-step-(\d+)$/);
      if (!m) continue;
      const clipIdx = parseInt(m[1], 10);
      const stepIdx = parseInt(m[2], 10);
      const nodeResult = result.byNode[n.id];
      const costUsd = nodeResult ? nodeResult.costUsd : 0;
      if (!byClip.has(clipIdx)) byClip.set(clipIdx, []);
      byClip.get(clipIdx).push({ stepIdx, costUsd, node: n, isEstimate: nodeResult ? nodeResult.isEstimate : false });
    }

    const pad = (s, n) => String(s).slice(0, n).padEnd(n, ' ');
    const clipW = 14;
    const stepW = 10;
    const chargeW = 12;
    const ioW = 44;
    const rowLen = 3 + clipW + 3 + stepW + 3 + chargeW + 3 + ioW + 2; // │ spaces and padding
    const border = (char) => ` ${char.repeat(rowLen - 2)} `;
    const row = (a, b, c, d) => ` │ ${pad(a, clipW)} │ ${pad(b, stepW)} │ ${pad(c, chargeW)} │ ${pad(d, ioW)} │`;

    log(`${logPrefix} ${border('═')}`);
    log(`${logPrefix} │ ${pad('COST BREAKDOWN (USD)', rowLen - 4)} │`);
    log(`${logPrefix} ${border('─')}`);
    log(`${logPrefix} ${row('Clip', 'Step', 'Charge (USD)', 'Inputs → Outputs')}`);
    log(`${logPrefix} ${border('─')}`);

    for (const clipIdx of [...byClip.keys()].sort((a, b) => a - b)) {
      const steps = byClip.get(clipIdx);
      steps.sort((a, b) => a.stepIdx - b.stepIdx);
      let clipTotal = 0;
      const wfId = clips[clipIdx] && clips[clipIdx].wf_id != null ? clips[clipIdx].wf_id : null;
      const clipLabel = wfId != null ? `${clipIdx} (wf: ${wfId})` : `${clipIdx}`;

      for (const { stepIdx, costUsd, node, isEstimate } of steps) {
        clipTotal += costUsd;
        const inputs = (node.data && node.data.inputs) ? node.data.inputs.map(i => i.type).join(', ') : '';
        const outputs = (node.data && node.data.outputs) ? node.data.outputs.map(o => o.type).join(', ') : '';
        const io = `[${inputs}] → [${outputs}]${isEstimate ? ' (est.)' : ''}`;
        log(`${logPrefix} ${row(clipLabel, `step ${stepIdx}`, `$${Number(costUsd).toFixed(4)}`, io)}`);
      }
      log(`${logPrefix} ${row('', 'total', `$${Number(clipTotal).toFixed(4)}`, '')}`);
      log(`${logPrefix} ${border('─')}`);
    }

    log(`${logPrefix} ${row('TOTAL', '', `$${rounded}`, '')}`);
    log(`${logPrefix} ${border('═')}`);
  } else if (verbose) {
    log(`${logPrefix} Total cost_in_dollars = ${rounded} USD (no AI steps in clips)`);
  }

  return rounded;
}

exports.computeWorkflowCost = computeWorkflowCost;
exports.computeNodeCost = computeNodeCost;
exports.buildNodesFromClips = buildNodesFromClips;
exports.extractModelIdsFromClips = extractModelIdsFromClips;
exports.computeTemplateCostFromClips = computeTemplateCostFromClips;
exports.costsToCanonicalPricing = costsToCanonicalPricing;
exports.DEFAULTS = DEFAULTS;
exports.ASSUMED_PER_RUN = ASSUMED_PER_RUN;

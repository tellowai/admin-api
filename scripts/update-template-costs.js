'use strict';

/**
 * Script to update template cost_in_dollars and template_type for non-ai templates
 * 
 * This script:
 * 1. Reads all templates from the database in batches
 * 2. Calculates cost in dollars using the same logic as create/update templates API
 * 3. Updates cost_in_dollars for each template in bulk
 * 4. For non-ai templates, randomly sets template_type to 'free' or 'premium'
 * 
 * Uses bulk operations for better performance:
 * - Batch size: 500 templates per batch (standard MySQL batch size)
 * - Bulk fetch clips for multiple templates
 * - Bulk update using CASE WHEN statements
 */

const mysqlQueryRunner = require('../modules/core/models/mysql.promise.model');
const TEMPLATE_CONSTANTS = require('../modules/templates/constants/template.constants');
const AiModelModel = require('../modules/ai-models/models/ai-model.model');
const logger = require('../config/lib/logger');

// Batch size for processing templates
const BATCH_SIZE = 500;

/**
 * Extract all AI model occurrences from clips for cost calculation
 * Returns array of model occurrences with context (clip, step, quality, duration)
 * @param {Array} clips
 * @returns {Array<Object>}
 */
function extractAiModelOccurrencesFromClips(clips) {
  const modelOccurrences = [];
  
  for (let clipIndex = 0; clipIndex < clips.length; clipIndex++) {
    const clip = clips[clipIndex];
    if (!clip || !Array.isArray(clip.workflow)) continue;
    
    for (let stepIndex = 0; stepIndex < clip.workflow.length; stepIndex++) {
      const step = clip.workflow[stepIndex];
      if (!step || !Array.isArray(step.data)) continue;
      
      let modelId = null;
      let videoQuality = null;
      let videoDuration = null;
      let prompt = null;
      
      // Extract model ID and context from step data
      for (const item of step.data) {
        if (item && item.type === 'ai_model' && item.value) {
          modelId = item.value;
        } else if (item && item.type === 'video_quality' && item.value) {
          videoQuality = item.value;
        } else if (item && item.type === 'video_duration' && item.value) {
          videoDuration = item.value;
        } else if (item && item.type === 'prompt' && item.value) {
          prompt = item.value;
        }
      }
      
      if (modelId) {
        modelOccurrences.push({
          modelId,
          clipIndex,
          stepIndex,
          videoQuality,
          videoDuration,
          prompt: prompt ? prompt.substring(0, 100) + '...' : null,
          workflowCode: step.workflow_code,
          workflowId: step.workflow_id
        });
      }
    }
  }
  
  return modelOccurrences;
}

/**
 * Normalize costs from string or object
 */
function normalizeCosts(costs) {
  if (!costs) return {};
  try {
    return typeof costs === 'string' ? JSON.parse(costs) : costs;
  } catch (_e) {
    return {};
  }
}

/**
 * Calculate video output cost based on quality and duration
 */
function calculateVideoOutputCost(occurrence, videoCosts) {
  const quality = occurrence.videoQuality || '720p';
  const duration = occurrence.videoDuration || '5s';
  
  if (!videoCosts[quality]) {
    const availableQualities = Object.keys(videoCosts);
    if (availableQualities.length === 0) return 0;
    const fallbackQuality = availableQualities[0];
    return calculateVideoCostForQuality(duration, videoCosts[fallbackQuality]);
  }
  
  return calculateVideoCostForQuality(duration, videoCosts[quality]);
}

/**
 * Calculate video cost for a specific quality and duration
 */
function calculateVideoCostForQuality(duration, qualityCosts) {
  const durationSeconds = parseInt(duration.replace('s', '')) || 5;
  
  // Try per_segment pricing first
  if (qualityCosts.per_segment) {
    const segmentKey = duration;
    if (qualityCosts.per_segment[segmentKey]) {
      return qualityCosts.per_segment[segmentKey];
    }
    
    // Try 5s segment as fallback
    if (qualityCosts.per_segment['5s']) {
      return qualityCosts.per_segment['5s'];
    }
  }
  
  // Try per_second pricing
  if (qualityCosts.per_second) {
    return qualityCosts.per_second * durationSeconds;
  }
  
  return 0;
}

/**
 * Calculate the cost for a specific model occurrence based on its context
 */
function calculateOccurrenceCost(occurrence, costs, model) {
  let totalCost = 0;
  
  // Handle input costs (text, image)
  if (costs.input) {
    // Text input cost
    if (costs.input.text && occurrence.workflowCode !== 'static-image') {
      totalCost += costs.input.text;
    }
    
    // Image input cost (per megapixel)
    if (costs.input.image && costs.input.image.per_megapixel) {
      const imageCost = costs.input.image.per_megapixel * TEMPLATE_CONSTANTS.DEFAULT_IMAGE_MEGAPIXELS;
      totalCost += imageCost;
    }
  }
  
  // Handle output costs
  if (costs.output) {
    // Image output cost
    if (costs.output.image && costs.output.image.per_megapixel) {
      const imageCost = costs.output.image.per_megapixel * TEMPLATE_CONSTANTS.DEFAULT_IMAGE_MEGAPIXELS;
      totalCost += imageCost;
    }
    
    // Video output cost
    if (costs.output.video) {
      const videoCost = calculateVideoOutputCost(occurrence, costs.output.video);
      totalCost += videoCost;
    }
    
    // Audio output cost
    if (costs.output.audio && costs.output.audio.price && costs.output.audio.seconds) {
      totalCost += costs.output.audio.price;
    }
  }
  
  return totalCost;
}

/**
 * Calculate cost in USD from clips for AI templates
 * Returns the USD value directly
 */
async function calculateUsdFromClips(clips, modelMap) {
  const modelOccurrences = extractAiModelOccurrencesFromClips(clips);
  
  if (modelOccurrences.length === 0) {
    return 0;
  }

  let totalUsd = 0;
  
  // Calculate cost for each model occurrence
  for (const occurrence of modelOccurrences) {
    const model = modelMap.get(occurrence.modelId);
    
    if (!model) {
      totalUsd += TEMPLATE_CONSTANTS.DEFAULT_MODEL_INVOCATION_USD;
      continue;
    }
    
    if (model.status !== 'active') {
      totalUsd += TEMPLATE_CONSTANTS.DEFAULT_MODEL_INVOCATION_USD;
      continue;
    }
    
    const costs = normalizeCosts(model.costs);
    const occurrenceCost = calculateOccurrenceCost(occurrence, costs, model);
    totalUsd += occurrenceCost;
  }

  return totalUsd;
}

/**
 * Calculate credits for non-AI templates based on output type and clips
 * This matches the logic from template.controller.js
 * @param {string} outputType - Template output type (image, video, audio)
 * @param {Array} clips - Template clips array
 * @returns {number} - Credits required
 */
function calculateNonAiTemplateCredits(outputType, clips) {
  const baseCredits = outputType === 'video' ? TEMPLATE_CONSTANTS.NON_AI_VIDEO_BASE_CREDITS : TEMPLATE_CONSTANTS.NON_AI_IMAGE_BASE_CREDITS;
  
  // For videos, add 0.003 USD per clip
  if (outputType === 'video' && clips && clips.length > 0) {
    // Add 0.003 USD per clip (0.15 credits per clip at $0.02 per credit)
    const additionalCredits = Math.ceil((clips.length * 0.003) / TEMPLATE_CONSTANTS.USD_PER_CREDIT);
    return baseCredits + additionalCredits;
  }
  
  return baseCredits;
}

/**
 * Bulk get template AI clips for multiple templates
 */
async function getTemplateAiClipsBulk(templateIds) {
  if (!templateIds || templateIds.length === 0) {
    return {};
  }

  const placeholders = templateIds.map(() => '?').join(',');
  const query = `
    SELECT 
      tac_id,
      template_id,
      clip_index,
      asset_type,
      created_at,
      updated_at
    FROM template_ai_clips
    WHERE template_id IN (${placeholders})
    AND deleted_at IS NULL
    ORDER BY template_id, clip_index ASC
  `;

  const clips = await mysqlQueryRunner.runQueryInSlave(query, templateIds);
  
  // Group clips by template_id
  const clipsByTemplate = {};
  for (const clip of clips) {
    if (!clipsByTemplate[clip.template_id]) {
      clipsByTemplate[clip.template_id] = [];
    }
    clipsByTemplate[clip.template_id].push(clip);
  }
  
  // Get workflows for all clips in bulk
  if (clips.length > 0) {
    const tacIds = clips.map(c => c.tac_id);
    const tacPlaceholders = tacIds.map(() => '?').join(',');
    const workflowQuery = `
      SELECT 
        cw_id,
        tac_id,
        workflow,
        created_at,
        updated_at
      FROM clip_workflow
      WHERE tac_id IN (${tacPlaceholders})
      AND deleted_at IS NULL
      ORDER BY tac_id, cw_id ASC
    `;

    const workflowEntries = await mysqlQueryRunner.runQueryInSlave(workflowQuery, tacIds);
    
    // Create a map of workflows by tac_id
    const workflowsByTacId = {};
    for (const entry of workflowEntries) {
      if (!workflowsByTacId[entry.tac_id]) {
        workflowsByTacId[entry.tac_id] = [];
      }
      
      let workflow = entry.workflow;
      if (workflow && typeof workflow === 'string') {
        try {
          workflow = JSON.parse(workflow);
        } catch (e) {
          workflow = null;
        }
      }
      
      if (workflow) {
        workflowsByTacId[entry.tac_id].push(workflow);
      }
    }
    
    // Attach workflows to clips
    for (const templateId in clipsByTemplate) {
      for (const clip of clipsByTemplate[templateId]) {
        clip.workflow = workflowsByTacId[clip.tac_id] || [];
      }
    }
  }
  
  return clipsByTemplate;
}

/**
 * Bulk update templates using CASE WHEN statements
 */
async function bulkUpdateTemplates(updates) {
  if (!updates || updates.length === 0) {
    return;
  }

  // Build CASE WHEN statements for cost_in_dollars and template_type
  const costCases = [];
  const typeCases = [];
  const templateIds = [];
  const costParams = [];
  const typeParams = [];

  for (const update of updates) {
    costCases.push(`WHEN ? THEN ?`);
    typeCases.push(`WHEN ? THEN ?`);
    templateIds.push(update.template_id);
    // Parameters for cost_in_dollars CASE: [id1, cost1, id2, cost2, ...]
    costParams.push(update.template_id, update.cost_in_dollars);
    // Parameters for template_type CASE: [id1, type1, id2, type2, ...]
    typeParams.push(update.template_id, update.template_type);
  }

  const placeholders = templateIds.map(() => '?').join(',');
  const query = `
    UPDATE templates
    SET 
      cost_in_dollars = CASE template_id
        ${costCases.join(' ')}
      END,
      template_type = CASE template_id
        ${typeCases.join(' ')}
      END
    WHERE template_id IN (${placeholders})
  `;

  // Combine params in correct order: cost params, type params, then WHERE IN params
  const allParams = [...costParams, ...typeParams, ...templateIds];
  await mysqlQueryRunner.runQueryInMaster(query, allParams);
}

/**
 * Process a batch of templates
 */
async function processBatch(templates, batchNumber, totalBatches) {
  logger.info(`Processing batch ${batchNumber}/${totalBatches} (${templates.length} templates)...`);
  
  const updates = [];
  const aiTemplateIds = [];
  let clipsByTemplate = {};
  let modelMap = new Map();

  // Separate AI templates that need clips
  for (const template of templates) {
    if (template.template_clips_assets_type === 'ai' || 
        (template.template_clips_assets_type === null && template.template_id)) {
      aiTemplateIds.push(template.template_id);
    }
  }

  // Bulk fetch clips for AI templates
  if (aiTemplateIds.length > 0) {
    clipsByTemplate = await getTemplateAiClipsBulk(aiTemplateIds);
    
    // Collect all unique model IDs from all clips
    const allModelIds = new Set();
    for (const templateId in clipsByTemplate) {
      const clips = clipsByTemplate[templateId];
      const modelOccurrences = extractAiModelOccurrencesFromClips(clips);
      for (const occ of modelOccurrences) {
        allModelIds.add(occ.modelId);
      }
    }
    
    // Bulk fetch AI models
    if (allModelIds.size > 0) {
      const uniqueModelIds = Array.from(allModelIds);
      const aiModels = await AiModelModel.getAiModelsByPlatformModelIds(uniqueModelIds);
      
      // Create model map
      for (const model of aiModels) {
        modelMap.set(model.platform_model_id, model);
        modelMap.set(model.model_id, model);
      }
    }
  }

  // Process each template in the batch
  for (const template of templates) {
    try {
      let costInDollars = null;
      let templateType = template.template_type;
      
      // Calculate cost in dollars
      if (template.template_clips_assets_type === 'ai') {
        // For AI templates, get clips and calculate USD
        const clips = clipsByTemplate[template.template_id] || [];
        costInDollars = await calculateUsdFromClips(clips, modelMap);
        
        // Ensure minimum cost
        if (costInDollars === 0) {
          costInDollars = TEMPLATE_CONSTANTS.DEFAULT_MODEL_INVOCATION_USD;
        }
        
        // Set template_type to 'ai' for AI templates
        templateType = 'ai';
      } else if (template.template_clips_assets_type === 'non-ai') {
        // For non-AI templates, recalculate credits using the same logic as the API
        // Then convert to USD
        const clips = []; // Non-AI templates don't have clips
        const calculatedCredits = calculateNonAiTemplateCredits(template.template_output_type, clips);
        costInDollars = calculatedCredits * TEMPLATE_CONSTANTS.USD_PER_CREDIT;
        
        // Randomly set template_type to 'free' or 'premium' for non-AI templates
        templateType = Math.random() < 0.5 ? 'free' : 'premium';
      } else {
        // Fallback for templates with null or unknown template_clips_assets_type
        // Try to detect: if template has clips, treat as AI, otherwise use credits
        const clips = clipsByTemplate[template.template_id] || [];
        if (clips && clips.length > 0) {
          // Has clips, treat as AI template
          costInDollars = await calculateUsdFromClips(clips, modelMap);
          if (costInDollars === 0) {
            costInDollars = TEMPLATE_CONSTANTS.DEFAULT_MODEL_INVOCATION_USD;
          }
          // Set template_type to 'ai' since it has clips
          templateType = 'ai';
        } else {
          // No clips, use credits to calculate USD
          const credits = template.credits || 1;
          costInDollars = credits * TEMPLATE_CONSTANTS.USD_PER_CREDIT;
          // Randomly set template_type to 'free' or 'premium' for templates without clips
          templateType = Math.random() < 0.5 ? 'free' : 'premium';
        }
      }
      
      // Round to 4 decimal places
      costInDollars = Math.round(costInDollars * 10000) / 10000;
      
      updates.push({
        template_id: template.template_id,
        cost_in_dollars: costInDollars,
        template_type: templateType,
        credits: template.credits,
        template_name: template.template_name
      });
      
    } catch (error) {
      logger.error(`Error processing template ${template.template_id} (${template.template_name}):`, {
        error: error.message,
        stack: error.stack
      });
    }
  }

  // Bulk update all templates in this batch
  if (updates.length > 0) {
    await bulkUpdateTemplates(updates);
    
    // Log results for each template
    logger.info(`\n=== Batch ${batchNumber} Update Results ===`);
    for (const update of updates) {
      logger.info(`Name: ${update.template_name} | Type: ${update.template_type} | Cost (USD): ${update.cost_in_dollars} | Credits: ${update.credits}`);
    }
    logger.info(`=== End Batch ${batchNumber} Results ===\n`);
  }

  return updates.length;
}

/**
 * Main function to update template costs
 */
async function updateTemplateCosts() {
  try {
    logger.info('Starting template cost update script with bulk operations...');
    
    // Get total count first (including archived templates)
    const countQuery = `
      SELECT COUNT(*) as total
      FROM templates
    `;
    const [countResult] = await mysqlQueryRunner.runQueryInSlave(countQuery, []);
    const totalTemplates = countResult.total;
    logger.info(`Total templates to process: ${totalTemplates} (including archived)`);
    
    let totalUpdated = 0;
    let totalErrors = 0;
    let offset = 0;
    let batchNumber = 0;
    const totalBatches = Math.ceil(totalTemplates / BATCH_SIZE);

    // Process templates in batches
    while (offset < totalTemplates) {
      batchNumber++;
      
      // Fetch batch of templates (including archived)
      const query = `
        SELECT 
          template_id,
          template_name,
          template_code,
          template_output_type,
          template_clips_assets_type,
          template_type,
          credits,
          cost_in_dollars
        FROM templates
        ORDER BY created_at ASC
        LIMIT ? OFFSET ?
      `;
      
      const templates = await mysqlQueryRunner.runQueryInSlave(query, [BATCH_SIZE, offset]);
      
      if (templates.length === 0) {
        break;
      }

      try {
        const updated = await processBatch(templates, batchNumber, totalBatches);
        totalUpdated += updated;
      } catch (error) {
        totalErrors += templates.length;
        logger.error(`Error processing batch ${batchNumber}:`, {
          error: error.message,
          stack: error.stack
        });
      }

      offset += BATCH_SIZE;
    }
    
    logger.info(`\n=== Final Summary ===`);
    logger.info(`Total templates processed: ${totalTemplates}`);
    logger.info(`Successfully updated: ${totalUpdated} templates`);
    logger.info(`Errors: ${totalErrors} templates`);
    logger.info(`=== End Summary ===\n`);
    
    process.exit(0);
    
  } catch (error) {
    logger.error('Fatal error in template cost update script:', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  updateTemplateCosts();
}

module.exports = {
  updateTemplateCosts,
  calculateUsdFromClips,
  calculateNonAiTemplateCredits
};

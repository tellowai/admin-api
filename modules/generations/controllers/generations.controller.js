'use strict';

const generationsModel = require('../models/generations.model');
const generationNodeExecutionsModel = require('../models/generation-node-executions.model');
const workflowNodeModel = require('../../workflow-builder/models/workflow.node.model');
const AiModelRegistryModel = require('../../workflow-builder/models/ai-model-registry.model');
const BoothAdminModel = require('../../photo-booths/models/photo-booth.admin.model');
const SupportModel = require('../../support/models/support.model');
const moment = require('moment');
const StorageFactory = require('../../os2/providers/storage.factory');
const TimezoneService = require('../../analytics/services/timezone.service');

const BOOTH_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Fixed page size for list generations; UI sends only page=1,2,3... */
const PER_PAGE = 10;

exports.listGenerations = async function (req, res) {
  try {
    const { start_date, end_date, tz } = req.query;
    const timezone = tz || TimezoneService.getDefaultTimezone();

    let startDate, endDate;

    // Default to today if no dates provided
    if (!start_date || !end_date) {
      startDate = moment().startOf('day').toDate();
      endDate = moment().endOf('day').toDate();
    } else {
      // Interpret start_date/end_date in client timezone and convert to UTC for query (same as analytics)
      const utcFilters = TimezoneService.convertToUTC(start_date, end_date, null, null, timezone);
      startDate = moment.utc(`${utcFilters.start_date} ${utcFilters.start_time}`).toDate();
      endDate = moment.utc(`${utcFilters.end_date} ${utcFilters.end_time}`).toDate();
    }

    // Fallback security on startDate being after endDate
    if (moment(startDate).isAfter(moment(endDate))) {
      return res.status(400).send({
        message: 'Start date cannot be after end date.'
      });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const { template_id, job_status } = req.query;
    const user_id = req.query.user_id ? String(req.query.user_id).trim() : '';
    const photo_booth_id = req.query.photo_booth_id ? String(req.query.photo_booth_id).trim() : '';
    if (photo_booth_id && !BOOTH_UUID_RE.test(photo_booth_id)) {
      return res.status(400).send({
        message: 'Invalid photo_booth_id'
      });
    }

    let generations;
    if (photo_booth_id) {
      const idRows = await BoothAdminModel.listMediaGenerationIdsInDateRange({
        photoBoothId: photo_booth_id,
        startDate,
        endDate,
        templateId: template_id || null,
        jobStatus: job_status || null,
        limit: PER_PAGE,
        offset: (page - 1) * PER_PAGE
      });
      const orderedIds = idRows.map((r) => r.media_generation_id).filter(Boolean);
      if (orderedIds.length === 0) {
        return res.json({ data: [] });
      }
      generations = await generationsModel.mergeGenerationRowsForIds(orderedIds, {});
    } else {
      generations = await generationsModel.getGenerationsByDateRange(startDate, endDate, page, PER_PAGE, {
        template_id,
        job_status,
        user_id: user_id || undefined
      });
    }

    const storage = StorageFactory.getProvider();

    // Collect distinct event IDs to fetch parent resource_generations
    const generationIds = [...new Set(generations.map(g => g.media_generation_id).filter(id => id))];
    
    // Fetch resource_generations in bulk from ClickHouse
    const fetchedResourceGenerations = await generationsModel.getResourceGenerationsByIds(generationIds);
    
    // Map resource_generations in memory
    const resourceGenMap = {};
    if (fetchedResourceGenerations) {
      fetchedResourceGenerations.forEach(rg => {
        resourceGenMap[rg.resource_generation_id] = rg;
      });
    }

    // Attach base generation details to event objects before user/template step
    generations.forEach(gen => {
      const parentGen = resourceGenMap[gen.media_generation_id];
      if (parentGen) {
        gen.user_id = parentGen.user_id;
        gen.template_id = parentGen.template_id;
        gen.media_type = parentGen.media_type;
        gen.created_at = parentGen.created_at; // use the true creation time of the generation
      }
    });

    // Collect distinct IDs for MySQL bulk fetching
    const userIds = [...new Set(generations.map(g => g.user_id).filter(id => id))];
    const templateIds = [...new Set(generations.map(g => g.template_id).filter(id => id))];

    // Bulk fetch users & templates concurrently from MySQL
    const [fetchedUsers, fetchedTemplates] = await Promise.all([
      generationsModel.getUsersByIds(userIds),
      generationsModel.getTemplatesByIds(templateIds)
    ]);

    // Build Maps for O(1) lookups
    const userMap = {};
    if (fetchedUsers) {
      fetchedUsers.forEach(u => {
        userMap[u.user_id] = u;
      });
    }

    const templateMap = {};
    if (fetchedTemplates) {
      fetchedTemplates.forEach(t => {
        templateMap[t.template_id] = t;
      });
    }

    // Process presigned URLs & map related properties
    for (let gen of generations) {
      // Map basic names
      if (gen.template_id && templateMap[gen.template_id]) {
        gen.template_name = templateMap[gen.template_id].template_name;
        gen.template_type = templateMap[gen.template_id].template_type;
      }
      
      if (gen.user_id && userMap[gen.user_id]) {
        let profilePicUrl = userMap[gen.user_id].profile_pic;
        const profilePicAssetKey = userMap[gen.user_id].profile_pic_asset_key;
        const profilePicBucket = userMap[gen.user_id].profile_pic_bucket;
        
        // Generate presigned URL if profile_pic_asset_key is available
        if (profilePicAssetKey) {
          try {
            if (profilePicBucket && profilePicBucket.includes('ephemeral')) {
              profilePicUrl = await storage.generateEphemeralPresignedDownloadUrl(profilePicAssetKey, { expiresIn: 3600 });
            } else {
              profilePicUrl = await storage.generatePresignedDownloadUrl(profilePicAssetKey, { expiresIn: 3600 });
            }
          } catch (e) {
            console.error(`Failed to generate presigned URL for profile_pic_asset_key: ${profilePicAssetKey}`, e);
            // Fallback to storing null on failure rather than breaking
          }
        } else if (profilePicUrl && !profilePicUrl.startsWith('http')) {
             // Fallback logic for legacy users where the key might act as profile_pic directly
             try {
                profilePicUrl = await storage.generatePresignedDownloadUrl(profilePicUrl, { expiresIn: 3600 });
             } catch(e) {
                console.error(`Failed to generate presigned URL for profile_pic key fallback: ${profilePicUrl}`, e);
             }
        }

        gen.user_details = {
          display_name: userMap[gen.user_id].display_name,
          email: userMap[gen.user_id].email,
          mobile: userMap[gen.user_id].mobile,
          profile_pic: profilePicUrl
        };
      }

      if (gen.output_media_asset_key) {
        try {
          if (gen.output_media_bucket && gen.output_media_bucket.includes('ephemeral')) {
            gen.media_url = await storage.generateEphemeralPresignedDownloadUrl(gen.output_media_asset_key, { expiresIn: 3600 });
          } else {
            gen.media_url = await storage.generatePresignedDownloadUrl(gen.output_media_asset_key, { expiresIn: 3600 });
          }
        } catch (e) {
          console.error(`Failed to generate presigned URL for key: ${gen.output_media_asset_key}`, e);
          gen.media_url = null;
        }
      }
    }

    res.json({
      data: generations
    });

  } catch (err) {
    console.error('Error fetching generations:', err);
    return res.status(500).send({
      message: 'Internal server error while fetching generations'
    });
  }
};

/**
 * Parse a JSON column (output_payload, input_payload, etc.). Return null if invalid.
 * @param {*} raw
 * @returns {object|null}
 */
function parseJsonPayloadColumn(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Recursively find all objects that have both asset_key and asset_bucket (strings) and need a url.
 * Calls visit(obj) for each such object. visit receives (obj, bucket, key).
 */
function visitAssetRefs(obj, visit) {
  if (obj == null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((item) => visitAssetRefs(item, visit));
    return;
  }
  const rawBucket = obj.asset_bucket;
  const key = obj.asset_key;
  if (typeof key === 'string' && key.trim() !== '') {
    const bucket =
      typeof rawBucket === 'string' && rawBucket.trim() !== ''
        ? rawBucket
        : 'private';
    visit(obj, bucket, key);
  }
  for (const value of Object.values(obj)) {
    visitAssetRefs(value, visit);
  }
}

/**
 * Collect unique (bucket, key) from each node's output_payload and input_payload: any nested object with
 * asset_key and asset_bucket that doesn't already have a string http url.
 * Returns Map keyed by 'bucket:key' -> { bucket, key }.
 */
function collectAssetRefsForPresign(rows) {
  const refs = new Map();
  for (const row of rows) {
    for (const col of ['output_payload', 'input_payload']) {
      const payload = parseJsonPayloadColumn(row[col]);
      if (!payload) continue;
      visitAssetRefs(payload, (obj, bucket, key) => {
        if (typeof obj.url === 'string' && obj.url.startsWith('http')) return;
        const refKey = `${bucket}:${key}`;
        if (!refs.has(refKey)) refs.set(refKey, { bucket, key });
      });
    }
  }
  return refs;
}

/**
 * Parse node_client_id from workflow v2: "{clipIndex}_{nodeType}#{systemType}#{wfnId}" (e.g. 1_SYSTEM_NODE#AI_MODEL#536).
 */
function parseWorkflowNodeClientId(nodeClientId) {
  if (!nodeClientId || typeof nodeClientId !== 'string') {
    return { isAe: false, clipIndex: null, wfnId: null, systemType: null, nodeKind: null };
  }
  if (nodeClientId === 'ae') {
    return { isAe: true, clipIndex: null, wfnId: null, systemType: null, nodeKind: 'ae' };
  }
  const parts = nodeClientId.split('#');
  if (parts.length < 3) {
    return { isAe: false, clipIndex: null, wfnId: null, systemType: null, nodeKind: null };
  }
  const wfnId = parseInt(parts[2], 10);
  const systemType = parts[1] || null;
  const prefix = parts[0];
  const us = prefix.indexOf('_');
  const clipPart = us > 0 ? prefix.slice(0, us) : '';
  const clipIndex = us > 0 ? parseInt(clipPart, 10) : NaN;
  const nodeKind = us > 0 ? prefix.slice(us + 1) : prefix;
  return {
    isAe: false,
    clipIndex: Number.isNaN(clipIndex) ? null : clipIndex,
    wfnId: Number.isNaN(wfnId) ? null : wfnId,
    systemType,
    nodeKind: nodeKind || null
  };
}

/**
 * Human-readable workflow node title: canvas label → registry model name (AI_MODEL) → custom_label → type slugs.
 * @param {object|null} nodeRow workflow_nodes row (amr_id, type, system_node_type, ui_metadata, config_values)
 * @param {Map<number, { amr_id: number, name: string, platform_model_id: string }>} [amrMap]
 */
function pickWorkflowNodeDisplayName(nodeRow, amrMap) {
  if (!nodeRow) return null;
  const meta = nodeRow.ui_metadata;
  if (meta && typeof meta === 'object' && typeof meta.label === 'string' && meta.label.trim()) {
    return meta.label.trim();
  }
  const cv = nodeRow.config_values;
  if (cv && typeof cv === 'object' && typeof cv.custom_label === 'string' && cv.custom_label.trim()) {
    return cv.custom_label.trim();
  }
  const isAiModel =
    String(nodeRow.type || '').toUpperCase() === 'AI_MODEL' ||
    String(nodeRow.system_node_type || '').toUpperCase() === 'AI_MODEL';
  if (isAiModel && nodeRow.amr_id != null && amrMap && amrMap.size) {
    const reg = amrMap.get(nodeRow.amr_id);
    if (reg && typeof reg.name === 'string' && reg.name.trim()) {
      return reg.name.trim();
    }
  }
  if (nodeRow.system_node_type) {
    return String(nodeRow.system_node_type).replace(/_/g, ' ');
  }
  if (nodeRow.type) {
    return String(nodeRow.type).replace(/_/g, ' ');
  }
  return null;
}

/**
 * Enrich each row's output_payload: for every nested object that has asset_key+asset_bucket, set .url from presigned map.
 * Also normalizes output_payload to parsed object for response.
 */
function enrichOutputPayloadsWithUrls(rows, urlByRefKey) {
  for (const row of rows) {
    const payload = parseJsonPayloadColumn(row.output_payload);
    if (!payload) continue;
    visitAssetRefs(payload, (obj, bucket, key) => {
      const url = urlByRefKey.get(`${bucket}:${key}`);
      if (url) obj.url = url;
    });
    row.output_payload = payload;
  }
}

/**
 * Same as output enrichment for input_payload (e.g. AE user_images with asset_key/asset_bucket after normalization).
 */
function enrichInputPayloadsWithUrls(rows, urlByRefKey) {
  for (const row of rows) {
    const payload = parseJsonPayloadColumn(row.input_payload);
    if (!payload) continue;
    visitAssetRefs(payload, (obj, bucket, key) => {
      const url = urlByRefKey.get(`${bucket}:${key}`);
      if (url) obj.url = url;
    });
    row.input_payload = payload;
  }
}

/**
 * Credit ledger rows for a single media generation (same data as support ticket "Generation Transactions").
 * No entitlement lookups — UI shows this block only when rows exist.
 */
exports.getGenerationCreditTransactions = async function (req, res) {
  try {
    const { mediaGenerationId } = req.params;
    if (!mediaGenerationId) {
      return res.status(400).send({ message: 'mediaGenerationId is required' });
    }
    const transactions = await SupportModel.getTransactionsForGeneration(mediaGenerationId);

    res.json({
      data: {
        transactions,
        paymentContext: {
          has_credit_ledger: transactions.length > 0
        }
      }
    });
  } catch (err) {
    console.error('Error fetching generation credit transactions:', err);
    return res.status(500).send({
      message: 'Internal server error while fetching generation credit transactions'
    });
  }
};

exports.getNodeExecutions = async function (req, res) {
  try {
    const { mediaGenerationId } = req.params;
    if (!mediaGenerationId) {
      return res.status(400).send({ message: 'mediaGenerationId is required' });
    }
    const [rows, mediaGeneration] = await Promise.all([
      generationNodeExecutionsModel.getByMediaGenerationId(mediaGenerationId),
      generationNodeExecutionsModel.getMediaGenerationTimestamps(mediaGenerationId)
    ]);

    const refs = collectAssetRefsForPresign(rows);
    if (refs.size > 0) {
      const storage = StorageFactory.getProvider();
      const opts = { expiresIn: 3600 };
      const urlByRefKey = new Map();
      await Promise.all(
        Array.from(refs.entries()).map(async ([refKey, { bucket, key }]) => {
          try {
            const url = await storage.generatePresignedDownloadUrlFromBucket(bucket, key, opts);
            urlByRefKey.set(refKey, url);
          } catch (e) {
            console.error(`Presign failed for ${refKey}:`, e.message);
          }
        })
      );
      enrichOutputPayloadsWithUrls(rows, urlByRefKey);
      enrichInputPayloadsWithUrls(rows, urlByRefKey);
    }

    // Ensure payloads are parsed objects in the JSON response (MySQL may return JSON columns as strings).
    for (const row of rows) {
      const ip = parseJsonPayloadColumn(row.input_payload);
      if (ip != null) row.input_payload = ip;
      const op = parseJsonPayloadColumn(row.output_payload);
      if (op != null) row.output_payload = op;
    }

    // Keep DB order (created_at ASC): matches worker insertion order (per-clip DAG execution order, then AE).

    let templateAiClips = [];
    const templateId = mediaGeneration && mediaGeneration.template_id;
    if (templateId) {
      try {
        templateAiClips = await generationNodeExecutionsModel.listTemplateAiClipsByTemplateId(templateId);
      } catch (e) {
        console.error('listTemplateAiClipsByTemplateId failed:', e.message);
      }
    }

    const wfnIds = [];
    for (const row of rows) {
      const p = parseWorkflowNodeClientId(row.node_client_id);
      if (p.wfnId != null) wfnIds.push(p.wfnId);
    }
    let wfnRows = [];
    try {
      wfnRows = await workflowNodeModel.getNodesByWfnIds(wfnIds);
    } catch (e) {
      console.error('getNodesByWfnIds failed:', e.message);
    }
    const wfnMap = new Map(wfnRows.map((n) => [n.wfn_id, n]));

    const amrIds = [...new Set(wfnRows.map((n) => n.amr_id).filter((id) => id != null))];
    let amrRows = [];
    try {
      amrRows = await AiModelRegistryModel.getByAmrIds(amrIds);
    } catch (e) {
      console.error('getByAmrIds (node executions timeline) failed:', e.message);
    }
    const amrMap = new Map(amrRows.map((r) => [r.amr_id, r]));

    for (const row of rows) {
      const parsed = parseWorkflowNodeClientId(row.node_client_id);
      row.timeline_clip_index = parsed.clipIndex;
      row.timeline_wfn_id = parsed.wfnId;
      row.timeline_system_type = parsed.systemType;
      row.ai_model_registry_name = null;
      row.ai_model_registry_platform_model_id = null;
      if (parsed.isAe) {
        row.workflow_node_display_name = 'After Effects render';
      } else if (parsed.wfnId != null) {
        const wfn = wfnMap.get(parsed.wfnId);
        if (wfn && wfn.amr_id != null) {
          const reg = amrMap.get(wfn.amr_id);
          if (reg) {
            row.ai_model_registry_name = reg.name || null;
            row.ai_model_registry_platform_model_id = reg.platform_model_id || null;
          }
        }
        row.workflow_node_display_name =
          pickWorkflowNodeDisplayName(wfn, amrMap) ||
          (parsed.systemType ? String(parsed.systemType).replace(/_/g, ' ') : null);
      } else {
        row.workflow_node_display_name = null;
      }
    }

    res.json({
      data: rows,
      mediaGeneration: mediaGeneration || null,
      templateAiClips
    });
  } catch (err) {
    console.error('Error fetching generation node executions:', err);
    return res.status(500).send({
      message: 'Internal server error while fetching node executions'
    });
  }
};

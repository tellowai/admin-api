'use strict';

const path = require('path');
const generationsModel = require('../models/generations.model');
const generationNodeExecutionsModel = require('../models/generation-node-executions.model');
const moment = require('moment');
const StorageFactory = require('../../os2/providers/storage.factory');
const paginationController = require('../../core/controllers/pagination.controller');

exports.listGenerations = async function (req, res) {
  try {
    const { start_date, end_date } = req.query;

    let startDate, endDate;

    // Default to today if no dates provided
    if (!start_date || !end_date) {
      startDate = moment().startOf('day').toDate();
      endDate = moment().endOf('day').toDate();
    } else {
      startDate = moment(start_date).startOf('day').toDate();
      endDate = moment(end_date).endOf('day').toDate();
    }

    // Fallback security on startDate being after endDate
    if (moment(startDate).isAfter(moment(endDate))) {
      return res.status(400).send({
        message: 'Start date cannot be after end date.'
      });
    }

    const { page, limit } = paginationController.getPaginationParams(req.query);

    // Page-based fetch only; no count. UI requests page=1,2,3... until empty data.
    const generations = await generationsModel.getGenerationsByDateRange(startDate, endDate, page, limit);

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
 * Parse output_payload (string or object). Return null if invalid.
 */
function parseOutputPayload(row) {
  let raw = row.output_payload;
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
  const bucket = obj.asset_bucket;
  const key = obj.asset_key;
  if (typeof bucket === 'string' && typeof key === 'string') {
    visit(obj, bucket, key);
  }
  for (const value of Object.values(obj)) {
    visitAssetRefs(value, visit);
  }
}

/**
 * Collect unique (bucket, key) from all nodes' output_payload: any nested object with asset_key and asset_bucket
 * that doesn't already have a string url. Returns Map keyed by 'bucket:key' -> { bucket, key }.
 */
function collectOutputAssetRefs(rows) {
  const refs = new Map();
  for (const row of rows) {
    const payload = parseOutputPayload(row);
    if (!payload) continue;
    visitAssetRefs(payload, (obj, bucket, key) => {
      if (typeof obj.url === 'string' && obj.url.startsWith('http')) return;
      const refKey = `${bucket}:${key}`;
      if (!refs.has(refKey)) refs.set(refKey, { bucket, key });
    });
  }
  return refs;
}

/**
 * Sort key for DAG order: node_client_id format "clipIndex_type#systemType#wfnId" (e.g. 1_SYSTEM_NODE#USER_INPUT_IMAGE#536).
 * Order: User input first, then AI model, then End. Legacy ids (ae, etc.) last.
 */
function nodeExecutionSortKey(row) {
  const id = row.node_client_id || '';
  if (id === 'ae') return [999, 99, 999];
  const firstHash = id.indexOf('#');
  if (firstHash === -1) return [0, 1, 0];
  const clipNum = parseInt(id.slice(0, firstHash).split('_')[0], 10) || 0;
  const afterFirst = id.slice(firstHash + 1);
  const parts = afterFirst.split('#');
  const systemType = parts[0] || '';
  const wfnId = parseInt(parts[1], 10) || 0;
  const typeOrder = { USER_INPUT_IMAGE: 0, AI_MODEL: 1, END: 2 }[systemType];
  const order = typeOrder !== undefined ? typeOrder : 1;
  return [clipNum, order, wfnId];
}

/**
 * Enrich each row's output_payload: for every nested object that has asset_key+asset_bucket, set .url from presigned map.
 * Also normalizes output_payload to parsed object for response.
 */
function enrichOutputPayloadsWithUrls(rows, urlByRefKey) {
  for (const row of rows) {
    const payload = parseOutputPayload(row);
    if (!payload) continue;
    visitAssetRefs(payload, (obj, bucket, key) => {
      const url = urlByRefKey.get(`${bucket}:${key}`);
      if (url) obj.url = url;
    });
    row.output_payload = payload;
  }
}

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

    const refs = collectOutputAssetRefs(rows);
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
    }

    rows.sort((a, b) => {
      const ka = nodeExecutionSortKey(a);
      const kb = nodeExecutionSortKey(b);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] - kb[1];
      return ka[2] - kb[2];
    });

    res.json({ data: rows, mediaGeneration: mediaGeneration || null });
  } catch (err) {
    console.error('Error fetching generation node executions:', err);
    return res.status(500).send({
      message: 'Internal server error while fetching node executions'
    });
  }
};

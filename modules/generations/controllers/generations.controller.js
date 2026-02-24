'use strict';

const path = require('path');
const generationsModel = require('../models/generations.model');
const moment = require('moment');
const StorageFactory = require('../../os2/providers/storage.factory');

exports.listGenerations = async function (req, res) {
  try {
    const { start_date, end_date, page = 1, limit = 20 } = req.query;

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

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // Run count and data query in parallel
    const [generations, totalCount] = await Promise.all([
      generationsModel.getGenerationsByDateRange(startDate, endDate, pageNum, limitNum),
      generationsModel.getGenerationsCountByDateRange(startDate, endDate)
    ]);

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
      data: generations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalElements: totalCount,
        totalPages: Math.ceil(totalCount / limitNum)
      }
    });

  } catch (err) {
    console.error('Error fetching generations:', err);
    return res.status(500).send({
      message: 'Internal server error while fetching generations'
    });
  }
};

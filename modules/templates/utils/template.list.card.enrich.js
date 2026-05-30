'use strict';

const config = require('../../../config/config');
const logger = require('../../../config/lib/logger');
const StorageFactory = require('../../os2/providers/storage.factory');

function alignImageTemplateThumbWithCfR2ForResponse(template) {
  if (!template || template.template_output_type !== 'image') return;
  if (template.cf_r2_key) {
    template.thumb_frame_asset_key = template.cf_r2_key;
    template.thumb_frame_bucket = template.cf_r2_bucket || 'public';
  }
  if (template.r2_url) {
    template.thumb_frame_url = template.r2_url;
  }
}

async function enrichTemplateListCardUrls(template) {
  if (!template) return template;
  const storage = StorageFactory.getProvider();

  if (template.cf_r2_key) {
    template.r2_url = `${config.os2.r2.public.bucketUrl}/${template.cf_r2_key}`;
  } else if (template.cf_r2_url) {
    template.r2_url = template.cf_r2_url;
  }

  if (template.thumb_frame_asset_key && template.thumb_frame_bucket) {
    try {
      const isPublic =
        template.thumb_frame_bucket === 'public' ||
        template.thumb_frame_bucket === storage.publicBucket ||
        template.thumb_frame_bucket === config.os2?.r2?.public?.bucket;

      if (isPublic) {
        template.thumb_frame_url = `${config.os2.r2.public.bucketUrl}/${template.thumb_frame_asset_key}`;
      } else {
        template.thumb_frame_url = await storage.generatePresignedDownloadUrl(
          template.thumb_frame_asset_key,
          { expiresIn: 3600 }
        );
      }
    } catch (error) {
      logger.error('enrichTemplateListCardUrls thumb_frame', {
        error: error.message,
        template_id: template.template_id
      });
      template.thumb_frame_url = null;
    }
  }

  alignImageTemplateThumbWithCfR2ForResponse(template);
  return template;
}

async function enrichTemplateListCardsUrls(templates) {
  if (!templates?.length) return [];
  return Promise.all(templates.map((t) => enrichTemplateListCardUrls(t)));
}

module.exports = {
  enrichTemplateListCardUrls,
  enrichTemplateListCardsUrls
};

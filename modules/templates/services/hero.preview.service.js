'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createId } = require('@paralleldrive/cuid2');
const logger = require('../../../config/lib/logger');
const config = require('../../../config/config');
const StorageFactory = require('../../os2/providers/storage.factory');
const TemplateModel = require('../models/template.model');
const TemplateRedisService = require('./template.redis.service');
const {
  webmDecoderForCodec,
  buildHeroPreviewExtractArgs,
  pngPixFmtHasAlpha,
} = require('../utils/hero.preview.ffmpeg');
const {
  buildHeroPreviewPngStorageKey,
  cleanupReplacedHeroPreviewPng,
} = require('../utils/hero.preview.storage');
const {
  normalizedMediaRef,
  refSignature,
} = require('../../os2/utils/r2-orphan-cleanup.util');

const VIDEO_TRANSPARENT_WEBM = 'video_transparent_webm';
const JOB_TTL_MS = 3600000;

class HeroPreviewService {
  constructor() {
    this.jobs = new Map();
  }

  getJobStatus(jobId) {
    return this.jobs.get(jobId) || null;
  }

  _scheduleJobExpiry(jobId) {
    setTimeout(() => this.jobs.delete(jobId), JOB_TTL_MS);
  }

  _resolveWebmSource(template) {
    const scenes = template.scenes || [];
    for (const scene of scenes) {
      const layer = (scene.layers || []).find((l) => {
        const t = l.layer_type || l.type;
        return t === VIDEO_TRANSPARENT_WEBM && l.asset_key && l.asset_bucket;
      });
      if (layer) {
        return { bucket: layer.asset_bucket, key: layer.asset_key };
      }
    }
    if (template.transparent_webm_video_key && template.transparent_webm_video_bucket) {
      return {
        bucket: template.transparent_webm_video_bucket,
        key: template.transparent_webm_video_key,
      };
    }
    return null;
  }

  _runProcess(bin, args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(bin, args);
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', (err) => reject(new Error(`${bin} failed to start: ${err.message}`)));
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`${bin} exit ${code}: ${stderr.slice(-500)}`));
      });
    });
  }

  async _probeVideoCodec(inputPath) {
    const stdout = await this._runProcess('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ]);
    return stdout.split('\n')[0]?.trim() || '';
  }

  async _probePngPixFmt(pngPath) {
    const stdout = await this._runProcess('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=pix_fmt',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      pngPath,
    ]);
    return stdout.split('\n')[0]?.trim() || '';
  }

  async _runFfmpegExtractFrame(inputPath, outputPath, frameIndex) {
    const codec = await this._probeVideoCodec(inputPath);
    const inputDecoder = webmDecoderForCodec(codec);
    const args = buildHeroPreviewExtractArgs({
      inputPath,
      outputPath,
      frameIndex,
      inputDecoder,
    });
    await this._runProcess('ffmpeg', args);

    const pixFmt = await this._probePngPixFmt(outputPath);
    if (!pngPixFmtHasAlpha(pixFmt)) {
      throw new Error(`HERO_PREVIEW_ALPHA_MISSING: output pix_fmt=${pixFmt || 'unknown'}`);
    }
    logger.info('hero_preview_png_alpha_ok', { codec, inputDecoder, pixFmt, frameIndex });
  }

  async _downloadToFile(storage, bucket, key, destPath) {
    const url = await storage.generatePresignedDownloadUrlFromBucket(bucket, key, { expiresIn: 3600 });
    const axios = require('axios');
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
    fs.writeFileSync(destPath, Buffer.from(response.data));
  }

  async generateHeroPreviewPng(templateId, options = {}) {
    const jobId = options.jobId || createId();
    const startedAt = Date.now();
    this.jobs.set(jobId, { status: 'IN_PROGRESS', templateId, startedAt });

    const tempDir = path.join(os.tmpdir(), `hero_preview_${jobId}`);
    try {
      const template = await TemplateModel.getTemplateGenerationMeta(templateId, { useMaster: true });
      if (!template) {
        throw new Error('TEMPLATE_NOT_FOUND');
      }

      if (template.ae_rendering_engine !== 'transparent_webm') {
        throw new Error('NOT_TRANSPARENT_WEBM_ENGINE');
      }

      let frameIndex = Number(template.hero_frame_index);
      if (!Number.isFinite(frameIndex) || frameIndex < 0) frameIndex = 0;
      if (template.template_output_type === 'image') {
        frameIndex = 0;
      }

      const webm = this._resolveWebmSource(template);
      if (!webm) {
        throw new Error('WEBM_SOURCE_MISSING');
      }

      fs.mkdirSync(tempDir, { recursive: true });
      const webmPath = path.join(tempDir, 'input.webm');
      const pngPath = path.join(tempDir, 'hero.png');
      const storage = StorageFactory.getProvider();

      await this._downloadToFile(storage, webm.bucket, webm.key, webmPath);
      await this._runFfmpegExtractFrame(webmPath, pngPath, frameIndex);

      const buffer = fs.readFileSync(pngPath);
      const pngKey = buildHeroPreviewPngStorageKey();
      const bucketLabel = 'public';
      const newHeroRef = normalizedMediaRef(bucketLabel, pngKey, bucketLabel);

      await storage.uploadBufferToPublicBucket(buffer, pngKey, {
        contentType: 'image/png',
      });

      const newUploaded = await storage.objectExistsInBucket(newHeroRef.bucket, newHeroRef.key);
      if (!newUploaded) {
        throw new Error('HERO_PREVIEW_UPLOAD_VERIFY_FAILED');
      }

      try {
        await TemplateModel.updateTemplate(templateId, {
          hero_frame_index: frameIndex,
          hero_preview_png_key: pngKey,
          hero_preview_png_bucket: bucketLabel,
        });
      } catch (dbErr) {
        try {
          await storage.deleteObjectFromBucket(newHeroRef.bucket, newHeroRef.key);
        } catch (rollbackErr) {
          logger.warn('hero_preview_png_rollback_delete_failed', {
            templateId,
            pngKey,
            error: rollbackErr.message,
          });
        }
        throw dbErr;
      }

      await TemplateRedisService.updateTemplateGenerationMeta(templateId);

      const updatedTemplate = await TemplateModel.getTemplateGenerationMeta(templateId, { useMaster: true });
      const persistedRef = normalizedMediaRef(
        updatedTemplate?.hero_preview_png_bucket,
        updatedTemplate?.hero_preview_png_key,
        bucketLabel,
      );
      if (refSignature(persistedRef) !== refSignature(newHeroRef)) {
        logger.warn('hero_preview_png_db_mismatch_skip_old_delete', {
          templateId,
          expectedKey: pngKey,
          persistedKey: persistedRef?.key || null,
        });
      } else {
        try {
          const cleanup = await cleanupReplacedHeroPreviewPng(storage, {
            oldBucket: template.hero_preview_png_bucket,
            oldKey: template.hero_preview_png_key,
            newBucket: bucketLabel,
            newKey: pngKey,
          });
          logger.info('hero_preview_png_old_cleanup', { templateId, ...cleanup });
        } catch (deleteErr) {
          logger.warn('hero_preview_png_old_delete_failed', {
            templateId,
            oldKey: template.hero_preview_png_key,
            newKey: pngKey,
            error: deleteErr.message,
          });
        }
      }

      const durationMs = Date.now() - startedAt;
      const result = {
        status: 'SUCCESS',
        templateId,
        hero_frame_index: frameIndex,
        hero_preview_png_key: pngKey,
        hero_preview_png_bucket: bucketLabel,
        hero_preview_png_url: `${config.os2.r2.public.bucketUrl}/${pngKey}`,
        duration_ms: durationMs,
        png_bytes: buffer.length,
      };
      this.jobs.set(jobId, { ...result, jobId });
      this._scheduleJobExpiry(jobId);
      logger.info('hero_preview_png_generated', result);
      return { jobId, ...result };
    } catch (error) {
      const fail = {
        status: 'FAILED',
        templateId,
        error_code: error.message || 'UNKNOWN',
        error_message: String(error.message || error).slice(0, 200),
        duration_ms: Date.now() - startedAt,
      };
      this.jobs.set(jobId, { ...fail, jobId });
      this._scheduleJobExpiry(jobId);
      logger.error('hero_preview_png_failed', { templateId, ...fail });
      throw error;
    } finally {
      try {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {
        logger.warn('hero_preview cleanup failed', { error: e.message });
      }
    }
  }
}

module.exports = new HeroPreviewService();

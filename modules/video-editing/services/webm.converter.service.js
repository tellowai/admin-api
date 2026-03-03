'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const { createId } = require('@paralleldrive/cuid2');
const logger = require('../../../config/lib/logger');
const StorageFactory = require('../../os2/providers/storage.factory');

const JOB_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes timeout

class WebmConverterService {
  constructor() {
    this.activeJobs = new Map();
  }

  getJobStatus(jobId) {
    return this.activeJobs.get(jobId);
  }

  async convertToWebm(colorVideoAsset, maskVideoAsset, jobId) {
    const tempDir = path.join(os.tmpdir(), `webm_conv_${jobId}`);
    const storage = StorageFactory.getProvider();
    let timeoutId;

    try {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      this.activeJobs.set(jobId, { status: 'IN_PROGRESS', progress: 0 });

      // Set a global safety timeout for the background job
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('Job timed out after 15 minutes'));
        }, JOB_TIMEOUT_MS);
      });

      // Wrap the logic in a promise to race against the timeout
      await Promise.race([
        this._executeConversion(colorVideoAsset, maskVideoAsset, jobId, tempDir, storage),
        timeoutPromise
      ]);

      clearTimeout(timeoutId);

    } catch (error) {
      logger.error('Error in WebmConverterService background process:', { 
        jobId, 
        errorMessage: error.message, 
        stack: error.stack 
      });
      this.activeJobs.set(jobId, { status: 'FAILED', error: error.message });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      
      // Resilient cleanup
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        logger.warn('Cleanup failed in WebmConverterService:', { jobId, error: cleanupError.message });
      }

      // Keep job status in memory for 1 hour for polling
      setTimeout(() => {
        this.activeJobs.delete(jobId);
      }, 3600000);
    }
  }

  async _executeConversion(colorVideoAsset, maskVideoAsset, jobId, tempDir, storage) {
    // 1. Download videos
    const colorPath = path.join(tempDir, 'color.mp4');
    const maskPath = path.join(tempDir, 'mask.mp4');
    const outputPath = path.join(tempDir, 'output.webm');

    const colorUrl = await storage.generatePresignedDownloadUrlFromBucket(colorVideoAsset.asset_bucket, colorVideoAsset.asset_key);
    const maskUrl = await storage.generatePresignedDownloadUrlFromBucket(maskVideoAsset.asset_bucket, maskVideoAsset.asset_key);

    await Promise.all([
      this._downloadFile(colorUrl, colorPath),
      this._downloadFile(maskUrl, maskPath)
    ]);

    this.activeJobs.set(jobId, { status: 'IN_PROGRESS', progress: 10 });

    // 2. Perform alpha merge with ffmpeg
    await this._runFFmpeg(colorPath, maskPath, outputPath, (progress) => {
      const adjustedProgress = 10 + (progress * 0.8);
      this.activeJobs.set(jobId, { status: 'IN_PROGRESS', progress: Math.min(90, Math.floor(adjustedProgress)) });
    });

    // 3. Upload to ephemeral bucket
    const outputKey = `webm_converter/${jobId}/output.webm`;
    const buffer = fs.readFileSync(outputPath);
    const uploadResult = await storage.uploadBufferToEphemeral(buffer, outputKey, { contentType: 'video/webm' });

    this.activeJobs.set(jobId, {
      status: 'COMPLETED',
      progress: 100,
      output: {
        asset_key: uploadResult.key,
        asset_bucket: uploadResult.bucket,
        url: uploadResult.url,
        file_size: uploadResult.size
      }
    });
  }

  async _downloadFile(url, dest) {
    try {
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        timeout: 60000 // 1 minute per file download
      });
      return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(dest);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', (err) => {
          writer.close();
          reject(err);
        });
      });
    } catch (err) {
      throw new Error(`Failed to download resource: ${err.message}`);
    }
  }

  async _runFFmpeg(colorPath, maskPath, outputPath, onProgress) {
    return new Promise((resolve, reject) => {
      // 1. Get duration using ffprobe
      const ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        colorPath
      ]);

      let duration = 0;
      let ffprobeError = '';

      ffprobe.stdout.on('data', (data) => {
        duration = parseFloat(data.toString());
      });

      ffprobe.stderr.on('data', (data) => {
        ffprobeError += data.toString();
      });

      ffprobe.on('error', (err) => {
        reject(new Error(`ffprobe failed to start: ${err.message}`));
      });

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          logger.warn(`ffprobe failed with code ${code}: ${ffprobeError}`);
        }

        // 2. Run FFmpeg
        const args = [
          '-i', colorPath,
          '-i', maskPath,
          '-filter_complex', '[0:v][1:v]alphamerge',
          '-c:v', 'libvpx-vp9',
          '-pix_fmt', 'yuva420p',
          '-b:v', '2M',
          '-crf', '30',
          '-c:a', 'libopus',
          '-y',
          outputPath
        ];

        const ffmpeg = spawn('ffmpeg', args);

        ffmpeg.stderr.on('data', (data) => {
          const content = data.toString();
          if (duration > 0) {
            const timeMatch = content.match(/time=(\d{2}):(\d{2}):(\d{2}.\d{2})/);
            if (timeMatch) {
              const hours = parseInt(timeMatch[1]);
              const minutes = parseInt(timeMatch[2]);
              const seconds = parseFloat(timeMatch[3]);
              const currentTime = (hours * 3600) + (minutes * 60) + seconds;
              const progress = Math.min(100, (currentTime / duration) * 100);
              onProgress(progress || 0);
            }
          }
        });

        ffmpeg.on('error', (err) => {
          reject(new Error(`ffmpeg failed to start: ${err.message}`));
        });

        ffmpeg.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`ffmpeg conversion failed with exit code ${code}`));
          }
        });
      });
    });
  }
}

module.exports = new WebmConverterService();

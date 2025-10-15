'use strict';

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const StorageProvider = require('./storage.provider');
const config = require('../../../config/config');
const { createId } = require('@paralleldrive/cuid2');
const path = require('path');
const axios = require('axios');
const https = require('https');
const log = require('../../../config/lib/logger');

class R2StorageProvider extends StorageProvider {
  constructor() {
    super();

    // Create HTTPS agent with relaxed SSL for R2 client
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false,
      keepAlive: true,
      keepAliveMsecs: 1000,
      maxSockets: 50
    });

    this.client = new S3Client({
      region: 'auto',
      endpoint: config.os2.r2.endpoint,
      credentials: {
        accessKeyId: config.os2.r2.accessKeyId,
        secretAccessKey: config.os2.r2.secretAccessKey
      },
      signatureVersion: 'v4',
      forcePathStyle: false,
      requestHandler: new NodeHttpHandler({
        httpsAgent: httpsAgent
      })
    });
    this.bucket = config.os2.r2.bucket;
    this.bucketUrl = config.os2.r2.bucketUrl;
    this.publicBucket = config.os2.r2.public.bucket;
    this.publicBucketUrl = config.os2.r2.public.bucketUrl;
    this.ephemeral = {
      bucket: config.os2.r2.ephemeral.bucket,
      bucketUrl: config.os2.r2.ephemeral.bucketUrl
    }
  }

  async generatePresignedUploadUrl(key, options = {}) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
      Metadata: options.metadata,
      ACL: 'private'
    });

    const url = await getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn || config.os2.upload.defaultExpiresIn,
      signatureVersion: 'v4'
    });

    return url;
  }

  async generateEphemeralPresignedUploadUrl(key, options = {}) {
    const command = new PutObjectCommand({
      Bucket: this.ephemeral.bucket,
      Key: key,
      ContentType: options.contentType,
      Metadata: options.metadata,
      ACL: 'private'
    });

    const url = await getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn || config.os2.upload.defaultExpiresIn,
      signatureVersion: 'v4'
    });

    return { url, bucket: this.ephemeral.bucket };
  }

  async generatePresignedDownloadUrl(key, options = {}) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    const url = await getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn || config.os2.download.defaultDownloadExpiresIn,
      signatureVersion: 'v4'
    });

    return url;
  }

  async generatePublicBucketPresignedDownloadUrl(key, options = {}) {
    const command = new GetObjectCommand({
      Bucket: this.publicBucket,
      Key: key
    });

    const url = await getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn || config.os2.download.defaultDownloadExpiresIn,
      signatureVersion: 'v4'
    });

    return url;
  }

  async generateEphemeralPresignedDownloadUrl(key, options = {}) {
    const command = new GetObjectCommand({
      Bucket: this.ephemeral.bucket,
      Key: key
    });

    const url = await getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn || config.os2.download.defaultDownloadExpiresIn,
      signatureVersion: 'v4'
    });

    return url;
  }

  async generatePresignedPublicBucketUploadUrl(key, options = {}) {
    const command = new PutObjectCommand({
      Bucket: this.publicBucket,
      Key: key,
      ContentType: options.contentType,
      Metadata: options.metadata,
      ACL: 'public-read'
    });

    const url = await getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn || config.os2.upload.defaultExpiresIn,
      signatureVersion: 'v4'
    });

    return url;
  }

  async uploadFromUrls(urls) {
    try {
      const uploadPromises = urls.map(async (url) => {
        try {
          // Fetch the file from URL
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`Failed to fetch file from URL: ${url}`);
          }

          const buffer = await response.buffer();
          const fileName = path.basename(url.split('?')[0]);

          // Generate unique filename by adding cuid prefix
          const uniqueId = createId();
          const uniqueFileName = `${uniqueId}_${fileName}`;
          const key = `assets/${uniqueFileName}`;

          // Upload to R2
          const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: buffer,
            ContentType: response.headers.get('content-type')
          });

          await this.client.send(command);

          return {
            status: 'success',
            originalUrl: url,
            r2Url: `${this.bucketUrl}/${key}`,
            fileName: uniqueFileName,
            key,
            contentType: response.headers.get('content-type'),
            size: buffer.length
          };
        } catch (error) {
          log.error('Error uploading file to R2', {
            error: error.message,
            url
          });
          return {
            originalUrl: url,
            error: error.message,
            status: 'failure',
            fileName: path.basename(url)
          };
        }
      });

      const results = await Promise.all(uploadPromises);
      return {
        files: results,
        summary: {
          total: results.length,
          successful: results.filter(r => r.status === 'success').length,
          failed: results.filter(r => r.status === 'failure').length
        }
      };
    } catch (error) {
      log.error('Error in batch upload to R2', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Copy object within R2 (same account, different buckets)
   */
  async copyWithinR2(sourceKey, sourceBucket, targetBucket, options = {}) {
    const fileName = path.basename(sourceKey.split('?')[0]);
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }

        // Map source bucket identifier to actual bucket name
        // Handle both same-env and cross-env scenarios
        let sourceBucketName;
        if (sourceBucket === 'public') {
          // Generic "public" identifier - use current environment's public bucket
          sourceBucketName = this.publicBucket;
        } else {
          // Specific bucket name (for cross-environment) - use as-is
          sourceBucketName = sourceBucket;
        }

        // Get source object metadata
        const headCommand = new HeadObjectCommand({
          Bucket: sourceBucketName,
          Key: sourceKey
        });
        const metadata = await this.client.send(headCommand);

        // Generate unique filename for target
        const uniqueId = createId();
        const uniqueFileName = `${uniqueId}_${fileName}`;
        const targetKey = options.keyPrefix ? `${options.keyPrefix}/${uniqueFileName}` : `assets/${uniqueFileName}`;

        // Determine target bucket
        const targetBucketName = targetBucket === 'public' || targetBucket === this.publicBucket
          ? this.publicBucket
          : this.bucket;

        const bucketUrl = targetBucket === 'public' || targetBucket === this.publicBucket
          ? this.publicBucketUrl
          : this.bucketUrl;

        // Copy object
        const copyCommand = new CopyObjectCommand({
          Bucket: targetBucketName,
          CopySource: `${sourceBucketName}/${sourceKey}`,
          Key: targetKey,
          ContentType: metadata.ContentType,
          ACL: targetBucketName === this.publicBucket ? 'public-read' : 'private'
        });

        await this.client.send(copyCommand);

        const finalUrl = `${bucketUrl}/${targetKey}`;

        return {
          key: targetKey,
          bucket: targetBucketName,
          url: finalUrl,
          contentType: metadata.ContentType,
          size: metadata.ContentLength
        };
      } catch (error) {
        lastError = error;
      }
    }

    log.error('Error copying within R2 after all retries', {
      error: lastError.message,
      sourceKey,
      sourceBucket,
      targetBucket
    });
    throw lastError;
  }

  /**
   * Upload a single file from URL to specific bucket
   */
  async uploadFromUrlToBucket(sourceUrl, sourceBucket, targetBucket, options = {}) {
    try {
      // Check if this is an intra-R2 copy (same account, different buckets)
      const isIntraR2Copy = !(/^https?:\/\//i.test(sourceUrl));

      if (isIntraR2Copy) {
        return await this.copyWithinR2(sourceUrl, sourceBucket, targetBucket, options);
      }

      const fileName = path.basename(sourceUrl.split('?')[0]);

      // Generate download URL from source bucket
      let downloadUrl;

      // Check if sourceUrl is already a full URL
      if (/^https?:\/\//i.test(sourceUrl)) {
        downloadUrl = sourceUrl;
      } else {
        // sourceUrl is a key, construct URL based on bucket
        if (sourceBucket === 'public' || sourceBucket === this.publicBucket) {
          // For public bucket, construct public URL directly
          downloadUrl = `${config.os2.r2.public.bucketUrl}/${sourceUrl}`;
        } else {
          // For private bucket, generate presigned URL
          downloadUrl = await this.generatePresignedDownloadUrl(sourceUrl);
        }
      }

      // Fetch the file with retry logic using axios with browser-like headers
      let buffer;
      let contentType;
      let lastError;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await axios.get(downloadUrl, {
            responseType: 'arraybuffer',
            timeout: 60000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': '*/*',
              'Accept-Encoding': 'gzip, deflate, br',
              'Accept-Language': 'en-US,en;q=0.9',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Pragma': 'no-cache',
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'same-origin'
            },
            httpsAgent: new https.Agent({
              rejectUnauthorized: false,
              keepAlive: false,
              minVersion: 'TLSv1.2',
              maxVersion: 'TLSv1.3'
            }),
            maxRedirects: 5,
            validateStatus: (status) => status >= 200 && status < 300
          });

          buffer = Buffer.from(response.data);
          contentType = response.headers['content-type'];
          break; // Success, exit retry loop
        } catch (err) {
          lastError = err;
          if (attempt < maxRetries) {
            const delay = 2000 * attempt;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (!buffer) {
        throw lastError || new Error('Failed to fetch file after retries');
      }

      // Generate unique filename
      const uniqueId = createId();
      const uniqueFileName = `${uniqueId}_${fileName}`;
      const key = options.keyPrefix ? `${options.keyPrefix}/${uniqueFileName}` : `assets/${uniqueFileName}`;

      // Determine target bucket
      const bucket = targetBucket === 'public' || targetBucket === this.publicBucket
        ? this.publicBucket
        : this.bucket;

      const bucketUrl = targetBucket === 'public' || targetBucket === this.publicBucket
        ? this.publicBucketUrl
        : this.bucketUrl;


      // Upload to target bucket
      console.log(`[Upload] Uploading to bucket: ${bucket}, key: ${key}`);

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType || options.contentType,
        ACL: bucket === this.publicBucket ? 'public-read' : 'private'
      });

      await this.client.send(command);

      const finalUrl = `${bucketUrl}/${key}`;

      return {
        key,
        bucket,
        url: finalUrl,
        contentType: contentType,
        size: buffer.length
      };
    } catch (error) {
      log.error('Error uploading file from URL to bucket', {
        error: error.message,
        sourceUrl,
        sourceBucket,
        targetBucket
      });
      throw error;
    }
  }
}

module.exports = R2StorageProvider;
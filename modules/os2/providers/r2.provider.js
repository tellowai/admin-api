'use strict';

const { 
  S3Client, 
  PutObjectCommand,
  GetObjectCommand 
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const StorageProvider = require('./storage.provider');
const config = require('../../../config/config');
const { createId } = require('@paralleldrive/cuid2');
const path = require('path');
const fetch = require('node-fetch');
const log = require('../../../config/lib/logger');

class R2StorageProvider extends StorageProvider {
  constructor() {
    super();
    this.client = new S3Client({
      region: 'auto',
      endpoint: config.os2.r2.endpoint,
      credentials: {
        accessKeyId: config.os2.r2.accessKeyId,
        secretAccessKey: config.os2.r2.secretAccessKey
      },
      signatureVersion: 'v4',
      forcePathStyle: false
    });
    this.bucket = config.os2.r2.bucket;
    this.bucketUrl = config.os2.r2.bucketUrl;
    this.publicBucket = config.os2.r2.public.bucket;
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
}

module.exports = R2StorageProvider;
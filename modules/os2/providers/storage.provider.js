'use strict';

/**
 * Abstract Storage Provider Interface
 */
class StorageProvider {
  async generatePresignedUploadUrl(key, options) {
    throw new Error('Method not implemented');
  }

  async generatePresignedDownloadUrl(key, options) {
    throw new Error('Method not implemented');
  }

  async deleteObject(key) {
    throw new Error('Method not implemented');
  }

  async generatePresignedDownloadUrlFromBucket(bucket, key, options) {
    throw new Error('Method not implemented');
  }
}

module.exports = StorageProvider; 
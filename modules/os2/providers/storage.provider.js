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

  /**
   * Delete object from a bucket (name or alias such as 'public' / 'private').
   * @param {string} bucket
   * @param {string} key
   */
  async deleteObjectFromBucket(bucket, key) {
    throw new Error('Method not implemented');
  }

  async generatePresignedDownloadUrlFromBucket(bucket, key, options) {
    throw new Error('Method not implemented');
  }

  /**
   * Get object content from bucket as string (e.g. for JSON files).
   * @param {string} bucket - Bucket name or alias ('public', 'private')
   * @param {string} key - Object key
   * @returns {Promise<string>} Body as string
   */
  async getObjectBodyFromBucket(bucket, key) {
    throw new Error('Method not implemented');
  }

  /**
   * Get object content from bucket as Buffer (e.g. for images).
   * @param {string} bucket - Bucket name or alias ('public', 'private')
   * @param {string} key - Object key
   * @returns {Promise<Buffer>} Body as Buffer
   */
  async getObjectBufferFromBucket(bucket, key) {
    throw new Error('Method not implemented');
  }

  /**
   * @param {string} bucket
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async objectExistsInBucket(bucket, key) {
    throw new Error('Method not implemented');
  }
}

module.exports = StorageProvider; 
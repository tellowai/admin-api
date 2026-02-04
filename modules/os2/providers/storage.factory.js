'use strict';

const R2StorageProvider = require('./r2.provider');
const config = require('../../../config/config');

class StorageFactory {
  static getProvider() {
    switch (config.os2.provider) {
      case 'r2':
        return new R2StorageProvider();
      // Add other providers here
      default:
        throw new Error(`Unsupported storage provider: ${config.storage.provider}`);
    }
  }

}

module.exports = StorageFactory; 
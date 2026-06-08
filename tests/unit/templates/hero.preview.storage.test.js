'use strict';

const { expect } = require('chai');
const {
  buildHeroPreviewPngStorageKey,
  cleanupReplacedHeroPreviewPng,
} = require('../../../modules/templates/utils/hero.preview.storage');

describe('hero.preview.storage', () => {
  describe('buildHeroPreviewPngStorageKey', () => {
    it('uses configured assets prefix and unique id with png extension', () => {
      const key = buildHeroPreviewPngStorageKey('abc123unique');
      expect(key).to.equal('assets/abc123unique.png');
    });

    it('generates different keys on each call', () => {
      const a = buildHeroPreviewPngStorageKey();
      const b = buildHeroPreviewPngStorageKey();
      expect(a).not.to.equal(b);
    });
  });

  describe('cleanupReplacedHeroPreviewPng', () => {
    it('skips delete when new object is not in bucket', async () => {
      const storage = {
        objectExistsInBucket: async () => false,
      };

      const result = await cleanupReplacedHeroPreviewPng(storage, {
        oldBucket: 'public',
        oldKey: 'assets/old.png',
        newBucket: 'public',
        newKey: 'assets/new.png',
      });

      expect(result).to.deep.equal({ deleted: false, reason: 'new_not_in_bucket' });
    });

    it('skips delete when old and new keys are the same', async () => {
      const storage = {
        objectExistsInBucket: async () => true,
      };

      const result = await cleanupReplacedHeroPreviewPng(storage, {
        oldBucket: 'public',
        oldKey: 'assets/same.png',
        newBucket: 'public',
        newKey: 'assets/same.png',
      });

      expect(result).to.deep.equal({ deleted: false, reason: 'unchanged_key' });
    });
  });
});

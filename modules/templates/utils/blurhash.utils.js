'use strict';

const sharp = require('sharp');
const { encode: encodeBlurhash } = require('blurhash');

/**
 * Generates a BlurHash string from an image buffer.
 * Resizes the image to a small size (32px) before encoding for performance.
 * @param {Buffer} input - The image buffer (JPEG, PNG, WebP, etc.)
 * @returns {Promise<string|null>} The BlurHash string, or null on failure
 */
async function generateBlurHashFromBuffer(input) {
  if (!Buffer.isBuffer(input) || input.length === 0) {
    return null;
  }
  try {
    const { data, info } = await sharp(input)
      .resize(32, 32, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const encodedHash = encodeBlurhash(
      new Uint8ClampedArray(data),
      info.width,
      info.height,
      4,
      3
    );
    return encodedHash;
  } catch (err) {
    return null;
  }
}

module.exports = {
  generateBlurHashFromBuffer
};

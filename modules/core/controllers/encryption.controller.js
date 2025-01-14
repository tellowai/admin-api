const crypto = require('crypto');
const i18next = require('i18next');
const config = require('../../../config/config');
const CUSTOM_ERROR_CODES = require('../controllers/customerrorcodes.server.controller').CODES;
const HTTP_STATUS_CODES = require('../controllers/httpcodes.server.controller').CODES;

// Decode the base64-encoded key
const ENCRYPTION_KEY = Buffer.from(config.encryption.common.key, 'base64'); // Should be 32 bytes
const IV_LENGTH = 12; // For AES-GCM

function encrypt(text) {
  // Validate key length
  if (ENCRYPTION_KEY.length !== 32) {
    throw {
        message: i18next.t('validation:DECRYPTION_FAILED'),
        customErrCode: CUSTOM_ERROR_CODES.INVALID_ENCRYPTION_KEY_LENGTH,
        httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
    };
  }
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);

  let encrypted = cipher.update(text, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const authTag = cipher.getAuthTag();

  const encryptedData = Buffer.concat([iv, authTag, encrypted]).toString('base64');
  return encryptedData;
}

function decrypt(encryptedData) {
  try {
    const data = Buffer.from(encryptedData, 'base64');
    const iv = data.slice(0, IV_LENGTH);
    const authTag = data.slice(IV_LENGTH, IV_LENGTH + 16);
    const encryptedText = data.slice(IV_LENGTH + 16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  } catch (err) {
    // Generic error message to prevent information leakage
    throw new Error(i18next.t('validation:DECRYPTION_FAILED'));
  }
}

function stringToHex(str) {
  let hex = '';
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    const hexValue = charCode.toString(16);
    // Ensure two digits for each byte
    hex += hexValue.padStart(2, '0');
  }
  return hex;
}

function hexToString(hex) {
  // Validate hex string
  if (hex.length % 2 !== 0 || !/^[0-9A-Fa-f]+$/.test(hex)) {
    throw new Error('Invalid hex string');
  }

  let str = '';
  for (let i = 0; i < hex.length; i += 2) {
    const charCode = parseInt(hex.substr(i, 2), 16);
    str += String.fromCharCode(charCode);
  }
  return str;

}

module.exports = { encrypt, decrypt, stringToHex, hexToString };
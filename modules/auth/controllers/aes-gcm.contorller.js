const crypto = require('crypto');
const config = require('../../../config/config')
const KEY = config.aes256gcm.secret;
const ALGO = 'aes-256-gcm';

exports.aes256gcm = {

  // encrypt returns base64-encoded ciphertext
  encrypt : function(str) {
    var key = KEY;

    // Hint: the `iv` should be unique (but not necessarily random).
    // `randomBytes` here are (relatively) slow but convenient for
    // demonstration.
    const iv = new Buffer.from(crypto.randomBytes(16), 'utf8').toString('base64');
    const cipher = crypto.createCipheriv(ALGO, key, iv);

    // Hint: Larger inputs (it's GCM, after all!) should use the stream API
    let enc = cipher.update(str, 'utf8', 'base64');
    enc += cipher.final('base64');
    
    return {
      encryptedCipher : enc, 
      iv : iv, 
      gcmAuthTag: cipher.getAuthTag().toString('base64')
    };
  },

  // decrypt decodes base64-encoded ciphertext into a utf8-encoded string
  decrypt : function (enc, iv, authTag) {
    const key = KEY;
    authTag = Buffer.from(authTag, 'base64')

    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    let str = decipher.update(enc, 'base64', 'utf8');
    str += decipher.final('utf8');
    
    return str;
  }
};

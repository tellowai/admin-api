'use strict';

/**
 * Apple ASN2 `signedTransactionInfo` is a 3-part JWS. The middle part is base64url(JSON) and is what Apple itself
 * shows in App Store Connect — bundleId, productId, transactionId, originalTransactionId, purchaseDate, price, currency, etc.
 *
 * For admin REVIEW purposes (read-only), decoding the payload without verifying the signature is sufficient — Apple's
 * verifier already ran at write time inside photobop-api. We keep this helper isolated so swapping in full verification
 * later (via @apple/app-store-server-library) is a one-file change.
 *
 * Never use this on a user-facing/funded fulfillment path. For that, use photobop-api's verifyApplePayment which has
 * full SignedDataVerifier semantics.
 */

function _b64urlToJson(b64url) {
  if (!b64url || typeof b64url !== 'string') return null;
  try {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = b64.length % 4 === 0 ? 0 : 4 - (b64.length % 4);
    const padded = b64 + '='.repeat(padLen);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
}

/**
 * @param {string|null|undefined} jws  three-part JWS (header.payload.signature)
 * @returns {Object|null} decoded transaction payload, or null on any failure
 */
function decodeSignedTransactionInfo(jws) {
  if (!jws || typeof jws !== 'string') return null;
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  return _b64urlToJson(parts[1]);
}

exports.decodeSignedTransactionInfo = decodeSignedTransactionInfo;

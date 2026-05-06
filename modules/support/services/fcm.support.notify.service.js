'use strict';

/**
 * Notify the ticket owner on all registered FCM devices when support sends a message or resolution.
 * Lazy-loads firebase-admin; no-op if credentials or module are missing.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../../config/lib/logger');
const config = require('../../../config/config');
const UserPushModel = require('../../user/models/user.push.model');

const NAVIGATE_SUPPORT_TICKET_DETAIL = 'NAVIGATE_SUPPORT_TICKET_DETAIL';

/** Same options as photobop-workers `FirebaseProvider` (see firebase.provider.js). */
const FCM_CREDENTIALS_HINT =
  'Set FIREBASE_SERVICE_ACCOUNT_JSON, GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT_PATH, messagingServices.firebase.providers.firebase_admin.serviceAccountPath in env config, or add config/env/firebase-service.json.';

let initialized = false;
let missingFirebaseAdminLogged = false;
let missingServiceAccountLogged = false;
/** @type {import('firebase-admin')|null} */
let resolvedFirebaseAdmin = null;
/** @type {'pending'|'ok'|'missing'|'load_error'} */
let firebaseAdminResolve = 'pending';

function getFirebaseAdmin() {
  if (firebaseAdminResolve === 'ok') {
    return resolvedFirebaseAdmin;
  }
  if (firebaseAdminResolve === 'missing' || firebaseAdminResolve === 'load_error') {
    return null;
  }
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    resolvedFirebaseAdmin = require('firebase-admin');
    firebaseAdminResolve = 'ok';
    return resolvedFirebaseAdmin;
  } catch (e) {
    resolvedFirebaseAdmin = null;
    if (e && e.code === 'MODULE_NOT_FOUND') {
      firebaseAdminResolve = 'missing';
      if (!missingFirebaseAdminLogged) {
        missingFirebaseAdminLogged = true;
        logger.warn('firebase-admin is not installed; support FCM is disabled.');
      }
    } else {
      firebaseAdminResolve = 'load_error';
      logger.error('Failed to load firebase-admin', { errorMessage: e && e.message, code: e && e.code });
    }
    return null;
  }
}

/**
 * Load Firebase service account JSON (same precedence as photobop-workers FirebaseProvider._getCredential).
 * @returns {object|null}
 */
function loadServiceAccountForFcm() {
  const jsonRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (jsonRaw && String(jsonRaw).trim()) {
    try {
      return JSON.parse(jsonRaw);
    } catch (e) {
      logger.error('Support FCM: FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON', { errorMessage: e.message });
      return null;
    }
  }
  const pathFromEnv = (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
  if (pathFromEnv) {
    const keyPath = path.isAbsolute(pathFromEnv) ? pathFromEnv : path.resolve(process.cwd(), pathFromEnv);
    if (!fs.existsSync(keyPath)) {
      logger.error('Support FCM: credential file not found', { keyPath, hint: FCM_CREDENTIALS_HINT });
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    } catch (e) {
      logger.error('Support FCM: failed to read or parse credential file', { keyPath, errorMessage: e.message });
      return null;
    }
  }
  const configPath = (config.messagingServices?.firebase?.providers?.firebase_admin?.serviceAccountPath || '').trim();
  if (configPath) {
    const keyPath = path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
    if (fs.existsSync(keyPath)) {
      try {
        return JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      } catch (e) {
        logger.error('Support FCM: failed to read serviceAccountPath from config', { keyPath, errorMessage: e.message });
        return null;
      }
    }
    logger.warn('Support FCM: config serviceAccountPath set but file not found', { keyPath });
  }
  const defaultPath = path.join(process.cwd(), 'config/env/firebase-service.json');
  if (fs.existsSync(defaultPath)) {
    try {
      return JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
    } catch (e) {
      logger.error('Support FCM: failed to read config/env/firebase-service.json', { errorMessage: e.message });
      return null;
    }
  }
  return null;
}

function tryInitAdmin() {
  const admin = getFirebaseAdmin();
  if (!admin) {
    return false;
  }
  if (initialized) {
    return true;
  }
  if (admin.apps && admin.apps.length) {
    initialized = true;
    return true;
  }
  try {
    const serviceAccount = loadServiceAccountForFcm();
    if (!serviceAccount) {
      if (!missingServiceAccountLogged) {
        missingServiceAccountLogged = true;
        logger.warn(`Support FCM disabled: no Firebase credentials. ${FCM_CREDENTIALS_HINT}`);
      }
      return false;
    }
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    initialized = true;
    return true;
  } catch (e) {
    logger.error('FCM admin init failed (support pushes disabled until fixed)', {
      errorMessage: e.message,
      code: e.code,
    });
    return false;
  }
}

function shouldDeactivateToken(code) {
  return (
    code === 'messaging/invalid-registration-token' ||
    code === 'messaging/registration-token-not-registered'
  );
}

/**
 * @param {string} userId
 * @param {string} ticketId
 * @param {{ title?: string, body?: string }} [opts]
 * @returns {Promise<void>}
 */
async function notifyUserSupportReply(userId, ticketId, opts = {}) {
  try {
    if (!userId || !ticketId) {
      return;
    }
    if (!tryInitAdmin()) {
      return;
    }

    let tokens;
    try {
      tokens = await UserPushModel.getActiveFcmTokensByUserId(userId);
    } catch (e) {
      logger.error('Support FCM: load tokens failed', { errorMessage: e.message, userId: String(userId) });
      return;
    }

    tokens = [...new Set(tokens.map((t) => String(t).trim()).filter(Boolean))];
    if (!tokens.length) {
      return;
    }

    const title = opts.title || 'Support';
    const body = opts.body || 'You have a new message.';
    const data = {
      action: NAVIGATE_SUPPORT_TICKET_DETAIL,
      ticketId: String(ticketId),
      type: 'support_reply',
    };

    const messagePayload = {
      notification: { title, body },
      data,
      android: { priority: 'high' },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    };

    const FCM_MULTICAST_MAX = 500;
    const admin = getFirebaseAdmin();
    if (!admin) {
      return;
    }

    for (let offset = 0; offset < tokens.length; offset += FCM_MULTICAST_MAX) {
      const chunk = tokens.slice(offset, offset + FCM_MULTICAST_MAX);
      const multicast = { ...messagePayload, tokens: chunk };
      let batch;
      try {
        batch = await admin.messaging().sendEachForMulticast(multicast);
      } catch (e) {
        logger.error('Support FCM sendEachForMulticast threw', {
          ticketId: String(ticketId),
          userId: String(userId),
          code: e.code,
          errorMessage: e.message,
          chunkSize: chunk.length,
        });
        return;
      }

      batch.responses.forEach((r, i) => {
        if (r.success) {
          return;
        }
        const err = r.error;
        const code = err && err.code;
        const token = chunk[i];
        if (shouldDeactivateToken(code)) {
          logger.info('Support FCM: invalid or unregistered token (marking device inactive)', {
            code,
            userId: String(userId),
            ticketId: String(ticketId),
          });
          UserPushModel.deactivateFcmToken(token).catch((deactErr) => {
            logger.warn('Support FCM token deactivate failed', { errorMessage: deactErr.message });
          });
        } else {
          logger.warn('Support FCM send failed', {
            ticketId: String(ticketId),
            userId: String(userId),
            code,
            errorMessage: err && err.message,
          });
        }
      });
    }
  } catch (e) {
    logger.warn('Support FCM notify failed', { errorMessage: e && e.message, ticketId: String(ticketId) });
  }
}

module.exports = {
  notifyUserSupportReply,
};

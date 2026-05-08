'use strict';

/**
 * Live Google Play Order resources via Android Publisher API (`orders.get` per ID).
 * Google does not expose “list all orders”; callers supply Play order IDs (e.g. from `orders.pg_order_id`), then we fetch Play first and attach DB rows afterward.
 * Uses the same service account shape as photobop-api: `config.google.clientEmail`, `config.google.privateKey`, `config.google.appPackageName`.
 */

const { google } = require('googleapis');
const config = require('../../../config/config');

function normalizePrivateKey(pk) {
  if (pk == null || pk === '') return '';
  const s = typeof pk === 'string' ? pk : String(pk);
  return s.includes('\\n') ? s.replace(/\\n/g, '\n') : s;
}

function getAndroidPublisherContext() {
  const g = config.google || {};
  const clientEmail = g.clientEmail != null ? String(g.clientEmail).trim() : '';
  const privateKey = normalizePrivateKey(g.privateKey);
  const packageName =
    (g.appPackageName != null && String(g.appPackageName).trim()) ||
    'ai.tellow.android';
  return { clientEmail, privateKey, packageName };
}

/**
 * @param {string[]} playOrderIds
 * @returns {Promise<{ ordersById: Record<string, object>, failures: Array<{ play_order_id: string, message: string, code?: string }>, skipped: boolean }>}
 */
async function batchGetOrdersByPlayOrderIds(playOrderIds) {
  const ids = [...new Set((playOrderIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
  const ordersById = Object.create(null);
  const failures = [];

  if (ids.length === 0) {
    return { ordersById, failures, skipped: false };
  }

  const { clientEmail, privateKey, packageName } = getAndroidPublisherContext();
  if (!clientEmail || !privateKey) {
    const err = new Error(
      'Google Play billing service account is not configured (set google.clientEmail and google.privateKey like photobop-api)'
    );
    err.code = 'GOOGLE_NOT_CONFIGURED';
    err.httpStatusCode = 503;
    throw err;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey
    },
    scopes: ['https://www.googleapis.com/auth/androidpublisher']
  });
  const androidpublisher = google.androidpublisher({ version: 'v3', auth });

  const chunkSize = 12;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const settled = await Promise.allSettled(
      chunk.map((orderId) =>
        androidpublisher.orders.get({ packageName, orderId }).then((resp) => ({ orderId, data: resp.data }))
      )
    );

    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      const requestedId = chunk[j];
      if (r.status === 'fulfilled') {
        const data = r.value.data;
        const oid = data && data.orderId != null ? String(data.orderId) : requestedId;
        ordersById[oid] = data;
        if (String(requestedId) !== oid) {
          ordersById[String(requestedId)] = data;
        }
      } else {
        const reason = r.reason;
        const status = reason && reason.response && reason.response.status;
        const apiMsg =
          reason &&
          reason.response &&
          reason.response.data &&
          reason.response.data.error &&
          reason.response.data.error.message;
        const msg = apiMsg || (reason && reason.message) || 'orders.get failed';
        failures.push({
          play_order_id: requestedId,
          message: msg,
          code: status === 404 ? 'PLAY_ORDER_NOT_FOUND' : 'GOOGLE_ORDERS_GET_FAILED'
        });
      }
    }
  }

  return { ordersById, failures, skipped: false };
}

exports.batchGetOrdersByPlayOrderIds = batchGetOrdersByPlayOrderIds;

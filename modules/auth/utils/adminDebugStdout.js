'use strict';

/**
 * Verbose auth/RBAC/token traces. Off by default; set ADMIN_DEBUG_STDOUT=1 or true to enable.
 * Grep: [admin-debug]
 */
function enabled() {
  const v = process.env.ADMIN_DEBUG_STDOUT;
  return v === '1' || String(v).toLowerCase() === 'true';
}

function tail(payload) {
  if (payload === undefined || payload === null) {
    return '';
  }
  try {
    return ' ' + JSON.stringify(payload);
  } catch (e) {
    return ' [admin-debug stringify failed]';
  }
}

exports.log = function adminDebugLog(step, payload) {
  if (!enabled()) return;
  console.log('[admin-debug] ' + step + tail(payload));
};

exports.warn = function adminDebugWarn(step, payload) {
  if (!enabled()) return;
  console.warn('[admin-debug] ' + step + tail(payload));
};

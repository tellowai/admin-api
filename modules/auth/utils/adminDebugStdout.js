'use strict';

/**
 * Prints only to process stdout/stderr (visible in Coolify/docker logs). Grep: [admin-debug]
 */
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
  console.log('[admin-debug] ' + step + tail(payload));
};

exports.warn = function adminDebugWarn(step, payload) {
  console.warn('[admin-debug] ' + step + tail(payload));
};

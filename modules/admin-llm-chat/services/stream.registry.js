'use strict';

/** Tracks in-flight SSE streams for graceful shutdown. */
const activeStreams = new Map();
let draining = false;

function streamKey(userId, conversationId) {
  return `${userId}:${conversationId}`;
}

function register(userId, conversationId, abortController) {
  activeStreams.set(streamKey(userId, conversationId), abortController);
}

function unregister(userId, conversationId) {
  activeStreams.delete(streamKey(userId, conversationId));
}

function get(userId, conversationId) {
  return activeStreams.get(streamKey(userId, conversationId));
}

function hasActive(userId, conversationId) {
  return activeStreams.has(streamKey(userId, conversationId));
}

function isDraining() {
  return draining;
}

function beginDrain() {
  draining = true;
}

async function drainAll({ timeoutMs = 25000, onAbort } = {}) {
  beginDrain();
  const controllers = [...activeStreams.values()];
  controllers.forEach((c) => {
    try {
      onAbort?.(c);
      c.abort();
    } catch (_e) { /* ignore */ }
  });
  const start = Date.now();
  while (activeStreams.size > 0 && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 200));
  }
  return { remaining: activeStreams.size };
}

module.exports = {
  register,
  unregister,
  get,
  hasActive,
  isDraining,
  beginDrain,
  drainAll,
  getActiveCount: () => activeStreams.size,
};

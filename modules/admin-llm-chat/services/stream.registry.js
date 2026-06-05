'use strict';

/** Tracks in-flight SSE streams for graceful shutdown. */
const activeStreams = new Map();
let draining = false;

// A turn caps at ~180s, but a client refresh keeps the server turn alive.
// Any entry older than this is treated as stale: aborted and evicted so a new
// send is never blocked by a long-dead turn.
const STALE_STREAM_MS = 10 * 60 * 1000;

function streamKey(userId, conversationId) {
  return `${userId}:${conversationId}`;
}

function register(userId, conversationId, abortController) {
  activeStreams.set(streamKey(userId, conversationId), {
    controller: abortController,
    startedAt: Date.now(),
  });
}

function unregister(userId, conversationId) {
  activeStreams.delete(streamKey(userId, conversationId));
}

/** Aborts + evicts a stream if it has outlived STALE_STREAM_MS. Returns true if evicted. */
function evictIfStale(key) {
  const entry = activeStreams.get(key);
  if (!entry) return false;
  if (Date.now() - entry.startedAt < STALE_STREAM_MS) return false;
  try {
    entry.controller?.abort();
  } catch (_e) { /* ignore */ }
  activeStreams.delete(key);
  return true;
}

function get(userId, conversationId) {
  const entry = activeStreams.get(streamKey(userId, conversationId));
  return entry?.controller;
}

function hasActive(userId, conversationId) {
  const key = streamKey(userId, conversationId);
  if (!activeStreams.has(key)) return false;
  if (evictIfStale(key)) return false;
  return true;
}

/** Active in-flight streams for this user (any conversation), after stale eviction. */
function countActiveForUser(userId) {
  const prefix = `${userId}:`;
  let count = 0;
  for (const key of activeStreams.keys()) {
    if (!key.startsWith(prefix)) continue;
    if (evictIfStale(key)) continue;
    count += 1;
  }
  return count;
}

function isDraining() {
  return draining;
}

function beginDrain() {
  draining = true;
}

async function drainAll({ timeoutMs = 25000, onAbort } = {}) {
  beginDrain();
  const controllers = [...activeStreams.values()].map((e) => e.controller);
  controllers.forEach((c) => {
    try {
      onAbort?.(c);
      c?.abort();
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
  countActiveForUser,
  isDraining,
  beginDrain,
  drainAll,
  getActiveCount: () => activeStreams.size,
};

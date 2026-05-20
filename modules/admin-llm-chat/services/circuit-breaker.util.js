'use strict';

const state = {};

function isOpen(name, { failureThreshold = 3, cooldownMs = 60000 } = {}) {
  const s = state[name];
  if (!s?.openUntil) return false;
  if (Date.now() >= s.openUntil) {
    delete state[name];
    return false;
  }
  return true;
}

function recordSuccess(name) {
  delete state[name];
}

function recordFailure(name, opts) {
  const threshold = opts?.failureThreshold || 3;
  const cooldownMs = opts?.cooldownMs || 60000;
  if (!state[name]) state[name] = { failures: 0, openUntil: null };
  state[name].failures += 1;
  if (state[name].failures >= threshold) {
    state[name].openUntil = Date.now() + cooldownMs;
  }
}

function reset(name) {
  delete state[name];
}

module.exports = { isOpen, recordSuccess, recordFailure, reset };

'use strict';

const CONSTANTS = require('../constants/admin-llm-chat.constants');

function initSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

let eventSeq = 0;

function sendEvent(res, event, data, id) {
  const eid = id !== undefined ? id : ++eventSeq;
  res.write(`id: ${eid}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
  return eid;
}

function startHeartbeat(res, onClose) {
  const interval = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (_e) {
      clearInterval(interval);
      onClose?.();
    }
  }, CONSTANTS.SSE_HEARTBEAT_MS);
  res.on('close', () => {
    clearInterval(interval);
    onClose?.();
  });
  return interval;
}

module.exports = { initSse, sendEvent, startHeartbeat };

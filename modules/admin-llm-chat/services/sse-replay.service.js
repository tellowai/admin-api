'use strict';

const CONSTANTS = require('../constants/admin-llm-chat.constants');

function replayKey(messageId) {
  return `${CONSTANTS.REDIS_PREFIX}:sse_replay:${messageId}`;
}

async function getRedis() {
  try {
    const redis = require('../../../config/lib/redis');
    return redis.redisClient;
  } catch (_e) {
    return null;
  }
}

async function appendEvent(messageId, eventLine) {
  const client = await getRedis();
  if (!client?.isReady || !messageId) return;
  const key = replayKey(messageId);
  await client.rPush(key, eventLine);
  await client.expire(key, CONSTANTS.SSE_REPLAY_TTL_SEC);
  const len = await client.lLen(key);
  if (len > CONSTANTS.SSE_REPLAY_MAX_EVENTS) {
    await client.lTrim(key, len - CONSTANTS.SSE_REPLAY_MAX_EVENTS, -1);
  }
}

async function getEventsAfter(messageId, lastEventId) {
  const client = await getRedis();
  if (!client?.isReady || !messageId) return [];
  const events = await client.lRange(replayKey(messageId), 0, -1);
  const after = parseInt(lastEventId, 10) || 0;
  return events.filter((line) => {
    const m = line.match(/^id: (\d+)/);
    return m && parseInt(m[1], 10) > after;
  });
}

module.exports = { appendEvent, getEventsAfter, replayKey };

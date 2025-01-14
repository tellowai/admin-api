const redis = require('redis');
const util = require('util');
var config = require('../../../config/config');
let redisClient = null;
let isConnecting = false;

const createRedisClient = () => {
  if (redisClient) {
    return redisClient; // Return the existing client if it exists
  }

  if (isConnecting) {
    return; // If a connection is already in progress, don't attempt to connect again
  }

  isConnecting = true;

  redisClient = redis.createClient({
    port: config.redis.auth.port,
    host: config.redis.auth.host,
    password: config.redis.auth.pass,
    retry_strategy: (options) => {
      if (options.error && options.error.code === 'ECONNREFUSED') {
        console.error('Redis server refused the connection. Stopping attempts to connect.');
        return new Error('Server refused the connection');
      }

      // If the retry attempts exceed a specific number, stop retrying
      if (options.attempt > 3) {
        console.error('Failed to connect to Redis after multiple attempts. Stopping retries.');
        return undefined;
      }

      // Wait for 2 seconds and then try again
      return 2000;
    }
  });

  redisClient.on('error', (err) => {
    console.error('Error connecting to Redis (rate-limiter):', err);
    redisClient = null; // Reset the client on error so that the next attempt will try to create a new connection
    isConnecting = false;
  });

  redisClient.on('ready', () => {
    isConnecting = false;
  });

  return redisClient;
};

createRedisClient(); // Initial Redis client creation


const PROJECT_PREFIX = config.redis.projectPrefix;
const RATE_LIMITER_PREFIX = 'rate_limiter:';
const DEFAULT_WINDOW_SIZE = 60000; // 60*1000
const MINUTE_WINDOW_SIZE = 60000; //60 * 1000;
const HOURLY_WINDOW_SIZE = 3600000; // 60 * 60 * 1000;
const DAILY_WINDOW_SIZE = 86400000; //24 * 60 * 60 * 1000;
let FINAL_PREFIX = `${PROJECT_PREFIX}${RATE_LIMITER_PREFIX}`;

const storeState = async (userId, actionName) => {
  const key = `${FINAL_PREFIX}${actionName}:${userId}`;
  const timestamp = Date.now();

  if (!redisClient) {
    console.error('Redis client is not initialized.');
    return; // Exit early if the client isn't available
  }

  // Add the current timestamp to the sorted set for the user
  redisClient.zadd(key, timestamp, timestamp);

  // Optionally, you can set an expiration time for this entry. This would be a backup in case you forget to prune.
  redisClient.expire(key, DAILY_WINDOW_SIZE / 1000);
};

const getActionCountInWindow = async (userId, actionName, windowType) => {
  let windowSize;

  switch (windowType) {
    case 'DAILY':
      windowSize = DAILY_WINDOW_SIZE;
      break;
    case 'HOURLY':
      windowSize = HOURLY_WINDOW_SIZE;
      break;
    case 'MINUTE':
      windowSize = MINUTE_WINDOW_SIZE;
      break;
    default:
      windowSize = DEFAULT_WINDOW_SIZE;
  }

  const WINDOW_SIZE = windowSize;

  const key = `${FINAL_PREFIX}${actionName}:${userId}`;
  const timestamp = Date.now();
  const windowStart = timestamp - WINDOW_SIZE;
  // Count the number of actions in the last 24 hours
  // const count = await redisClient.zcount(key, windowStart, timestamp);

  if (!redisClient) {
    console.error('Redis client is not initialized.');
    return; // Exit early if the client isn't available
  }
  
  // Convert the callback function to return a Promise
  const zcountAsync = util.promisify(redisClient.zcount).bind(redisClient);

  return zcountAsync(key, windowStart, timestamp);
};

module.exports = {
  storeState,
  getActionCountInWindow
};

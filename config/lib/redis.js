'use strict';

var redis = require('redis');
var config = require('../config');
var _ = require('lodash');
let redisClient = null;
let isConnecting = false;


const createRedisClient = () => {
  if (!isConnecting) {
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
      console.error('Error connecting to Redis (core):', err);
      // Optionally, you can handle the error more explicitly here,
      // such as retrying the connection after a delay or shutting down the application.
    });

    redisClient.on('ready', () => {
      isConnecting = false;
    });
  }
};

createRedisClient(); // Initial Redis client creation
module.exports.redisClient = redisClient;

exports.saveRefreshToken = function (refreshTokenObj, done) {

  redisClient.set(
    config.redis.sessionPrefix + refreshTokenObj.rsid,
    JSON.stringify(refreshTokenObj),
    function (err, res) {

      if (err) {
        return done(err);
      }

      redisClient.expire(
        config.redis.sessionPrefix + refreshTokenObj.rsid,
        config.refreshToken.expiresIn,
        function (err, res) {

          if (err) {
            return done(err);
          }

          return done(null, res)
        });
    });
};

exports.updateRefreshTokenData = function (data, done) {

  redisClient.multi()
    .ttl(config.redis.sessionPrefix + data.rsid)
    .get(config.redis.sessionPrefix + data.rsid)
    .exec(
      function (err, results) {

        if (err) {
          return done(err);
        }

        var remainingTtl = (results[0] && results[0] > 0) ?
          results[0] : '1';
        var redisRTObj = (results[1]) ? JSON.parse(results[1]) : undefined;

        if (_.isObject(data)) {

          // update obj with new data
          for (var key in data) {

            if (data.hasOwnProperty(key)) {

              if (key != 'refreshToken' && key != 'accessToken') {

                redisRTObj[key] = data[key];
              }
            }
          }
        }

        redisClient.set(
          config.redis.sessionPrefix + data.rsid,
          JSON.stringify(redisRTObj),
          function (err, res) {

            if (err) {
              return done(err);
            }

            redisClient.expire(
              config.redis.sessionPrefix + data.rsid,
              remainingTtl,
              function (err, res) {

                if (err) {
                  console.log(err);
                }
              });

            return done(null, res)
          });
      });
};

exports.getRefreshTokenData = function (rsid, done) {

  redisClient.get(
    config.redis.sessionPrefix + rsid, function (err, val) {
      if (err) {
        return done(err);
      }

      return done(null, JSON.parse(val));
    });
};

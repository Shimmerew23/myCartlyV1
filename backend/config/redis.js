const { createClient } = require('redis');
const logger = require('../utils/logger');

let redisClient = null;

const connectRedis = async () => {
  try {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error('Redis: Max reconnect attempts reached');
            return new Error('Max reconnect attempts reached');
          }
          return Math.min(retries * 100, 3000);
        },
      },
    });

    redisClient.on('error', (err) => logger.error(`Redis Client Error: ${err}`));
    redisClient.on('connect', () => logger.info('Redis: Connecting...'));
    redisClient.on('ready', () => logger.info('Redis: Connected and Ready'));
    redisClient.on('end', () => logger.warn('Redis: Connection closed'));

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    logger.warn(`Redis connection failed: ${error.message}. Running without cache.`);
    return null;
  }
};

const getRedisClient = () => redisClient;

// Cache helpers
const cache = {
  get: async (key) => {
    if (!redisClient) return null;
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      logger.error(`Cache GET error: ${err.message}`);
      return null;
    }
  },

  set: async (key, value, ttlSeconds = 300) => {
    if (!redisClient) return false;
    try {
      await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
      return true;
    } catch (err) {
      logger.error(`Cache SET error: ${err.message}`);
      return false;
    }
  },

  del: async (key) => {
    if (!redisClient) return false;
    try {
      await redisClient.del(key);
      return true;
    } catch (err) {
      logger.error(`Cache DEL error: ${err.message}`);
      return false;
    }
  },

  flush: async (pattern) => {
    if (!redisClient) return false;
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
      return true;
    } catch (err) {
      logger.error(`Cache FLUSH error: ${err.message}`);
      return false;
    }
  },

  // Blacklist JWT tokens on logout
  blacklistToken: async (token, expireSeconds) => {
    if (!redisClient) return false;
    try {
      await redisClient.setEx(`blacklist:${token}`, expireSeconds, '1');
      return true;
    } catch (err) {
      logger.error(`Token blacklist error: ${err.message}`);
      return false;
    }
  },

  isTokenBlacklisted: async (token) => {
    if (!redisClient) return false;
    try {
      const result = await redisClient.get(`blacklist:${token}`);
      return result === '1';
    } catch (err) {
      return false;
    }
  },
};

module.exports = { connectRedis, getRedisClient, cache };

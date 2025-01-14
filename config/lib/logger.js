const winston = require('winston');
const loggerConfig = require('./logger.config');

// Log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// Create a no-op logger when no transports are configured
const noopLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {}
};

// If no logging is configured, return the no-op logger
if (!loggerConfig.console && !loggerConfig.file) {
  module.exports = noopLogger;
  return;
}

// Custom format
const customFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaString = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaString}`;
  })
);

// Initialize transports array
const transports = [];

// Add file transports if enabled
if (loggerConfig.file) {
  transports.push(
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

// Add console transport if enabled
if (loggerConfig.console) {
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  );
}

// Create logger instance
const logger = winston.createLogger({
  level: loggerConfig.level,
  levels,
  format: customFormat,
  transports
});

// Create a wrapper that respects the logging configuration
const log = {
  error: (message, meta = {}) => {
    if (levels[loggerConfig.level] >= levels.error) {
      logger.error(message, meta);
    }
  },
  warn: (message, meta = {}) => {
    if (levels[loggerConfig.level] >= levels.warn) {
      logger.warn(message, meta);
    }
  },
  info: (message, meta = {}) => {
    if (levels[loggerConfig.level] >= levels.info) {
      logger.info(message, meta);
    }
  },
  debug: (message, meta = {}) => {
    if (levels[loggerConfig.level] >= levels.debug) {
      logger.debug(message, meta);
    }
  }
};

module.exports = log;
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && 
      warning.message.includes('punycode')) {
    return;
  }
  // express-session MemoryStore warning when no Redis store is used (e.g. Redis unavailable)
  if (warning.message && typeof warning.message === 'string' &&
      warning.message.includes('MemoryStore') && warning.message.includes('production')) {
    return;
  }
  console.warn(warning);
});

const config = require("./config/config");
const dns = require('dns');
// Prefer IPv4 to avoid environments with broken IPv6 causing ETIMEDOUT on fetch
try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}
const express = require("./config/lib/express");
const chalk = require("chalk");
const { initializeKafka } = require("./config/lib/kafka");
const http = require('http');

async function startServer() {
  
  // Initialize Kafka
  try {
    global.kafkaProducer = await initializeKafka();
  } catch (error) {
    console.error('Error initializing Kafka:', error);
    process.exit(1);
  }

  try {
    const schemaCache = require('./modules/admin-llm-chat/services/schema.cache.service');
    await schemaCache.refreshSchemaSnapshot();
  } catch (err) {
    console.warn(chalk.yellow('[admin-llm-chat] schema cache refresh skipped:'), err.message);
  }

  // Initialize Express
  const app = express.init();

  const server = http.createServer(app);

  // Initialize Socket.IO with the server
  // initSocketIo(server); 
  
  server.listen(config.appPort, function () {
    
    console.log(
      chalk.green(config.app.title + " is running on port " + config.appPort)
    );
    console.log(config.appDomain + ":" + config.appPort);
  });

  const streamRegistry = require('./modules/admin-llm-chat/services/stream.registry');
  let shuttingDown = false;

  async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(chalk.yellow(`[shutdown] ${signal} — draining admin LLM chat streams…`));
    server.close();
    const { remaining } = await streamRegistry.drainAll({ timeoutMs: 25000 });
    if (remaining > 0) {
      console.warn(chalk.yellow(`[shutdown] ${remaining} streams still active after drain timeout`));
    }
    try {
      if (global.kafkaProducer) await global.kafkaProducer.disconnect();
    } catch (_e) { /* ignore */ }
    process.exit(remaining > 0 ? 1 : 0);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  module.exports = app;
}

startServer();

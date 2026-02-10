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

  module.exports = app;
}

startServer();

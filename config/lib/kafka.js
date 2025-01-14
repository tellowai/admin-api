const { Kafka } = require('kafkajs');
const config = require('../config');

const MAX_RETRIES = config.kafka.maxRetries;
const RETRY_DELAY = config.kafka.retryDelay;

async function connectWithRetry(kafkaEntity, name, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await kafkaEntity.connect();
      console.log(`${name} connected successfully.`);
      return;
    } catch (error) {
      console.error(`Error connecting ${name}:`, error);
      if (attempt < retries) {
        console.log(`Retrying ${name} connection in ${RETRY_DELAY / 1000} seconds... (attempt ${attempt}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      } else {
        console.error(`Failed to connect ${name} after ${retries} attempts. Exiting...`);
        process.exit(1);
      }
    }
  }
}

async function setupKafka() {
  const kafka = new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
  });

  const producer = kafka.producer();
  await connectWithRetry(producer, 'Kafka producer');
  return { kafkaProducer: producer };
}

async function initializeKafka() {
  const { kafkaProducer: producer } = await setupKafka();
  return producer;
}

module.exports = { initializeKafka };

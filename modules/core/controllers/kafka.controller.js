'use strict';

const chalk = require('chalk');
const { TOPICS } = require('../constants/kafka.events.config');
const { createId } =  require('@paralleldrive/cuid2');
const moment = require('moment');
const config = require('../../../config/config');

/**
 * Sends a message to Kafka
 * @param {string} topic - The Kafka topic
 * @param {Array} messages - Array of messages to send
 * @param {string} eventName - Name of the event
 * @returns {Promise<void>}
 */
exports.sendMessage = async function(topic, messages, eventName) {
  try {
    // Validate inputs
    if (!topic || !messages || !eventName) {
      throw new Error('Missing required parameters: topic, messages, or eventName');
    }

    // Ensure the producer is connected
    if (!global.kafkaProducer) {
      throw new Error('Kafka producer not initialized');
    }

    // Add metadata to each message
    const enrichedMessages = messages.map(msg => ({
      ...msg,
      value: JSON.stringify({
        event_id: createId(),
        event: eventName,
        event_time: moment().format(config.moment.dbFormat),
        version: 'v1',
        data: msg.value,
        metadata: {
          producer: 'api-server',
          environment: process.env.NODE_ENV
        }
      })
    }));

    // Send the message to the specified topic
    await global.kafkaProducer.send({
      topic: topic.toUpperCase(),
      messages: enrichedMessages
    });

    console.log(
      chalk.green(
        `[Kafka] Message sent successfully to topic ${topic} with event ${eventName}`
      ),
      enrichedMessages
    );

  } catch (error) {
    const timestamp = new Date().toISOString();
    console.error(
      chalk.red(
        `[${timestamp}] Error sending Kafka message: ${error.message}`
      )
    );

    // Implement retry logic or dead letter queue here
    await handleKafkaError(error, topic, messages, eventName);

    throw error;
  }
};

/**
 * Handles Kafka errors with retry logic
 * @private
 */
async function handleKafkaError(error, topic, messages, eventName) {
  // TODO: Implement retry logic
  // 1. Store failed messages in a dead letter queue
  // 2. Implement exponential backoff retry
  // 3. Alert monitoring system
  // 4. Log detailed error information
  
  console.error(chalk.yellow(
    `[Kafka] Failed to send message to topic ${topic}. Error: ${error.message}`
  ));
}

// Re-export constants for backward compatibility
exports.TOPICS = TOPICS;

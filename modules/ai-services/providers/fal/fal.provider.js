'use strict';

const BaseAIProvider = require('../base.provider');
const { fal } = require('@fal-ai/client');
const log = require('../../../../config/lib/logger');
const { createId } = require('@paralleldrive/cuid2');


class FalAIProvider extends BaseAIProvider {
  constructor(options) {
    super(options); // Call super first before accessing this
    
    fal.config({
      credentials: options.apiKey
    });
    
    this.config = options; // Move this after super() call
  }

  async tuneModelWithPhotos(input, options = {}) {
    try {
      const modelId = this.config.tuning.modelId;

      const queueInput = {
        input: {
          images_data_url: input.images_data_url,
          trigger_word: input.trigger_word,
          steps: input.steps || this.config.defaultSteps
        }
      };

      const queueOptions = {
        webhookUrl: options.webhookUrl,
        ...options
      };

      const { request_id } = await fal.queue.submit(modelId, {
        ...queueInput,
        ...queueOptions
      });
      
      log.info('Submitted training job to Fal queue', {
        requestId: request_id,
        modelId,
        options
      });

      return {
        request_id,
        status: 'queued',
        queue_input: queueInput,
        queue_options: queueOptions
      };
    } catch (error) {
      log.error('Error submitting training job to Fal', {
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Error submitting training to Fal: ${error.message}`);
    }
  }

  async checkTuningStatus(requestId) {
    try {
      const modelId = this.imageConfig.tuning.modelId;

      const status = await fal.queue.status(modelId, {
        requestId,
        logs: true
      });
      
      log.info('Retrieved training job status from Fal', {
        requestId,
        status
      });

      return status;
    } catch (error) {
      log.error('Error checking training status with Fal', {
        error: error.message,
        stack: error.stack,
        requestId
      });
      throw new Error(`Error checking training status: ${error.message}`);
    }
  }

  async getTuningResult(requestId) {
    try {
      const modelId = this.config.tuning.modelId;

      const result = await fal.queue.result(modelId, {
        requestId
      });

      log.info('Retrieved training results from Fal', {
        requestId,
        result
      });

      return {
        data: result.data,
        requestId: result.requestId
      };
    } catch (error) {
      log.error('Error getting training results from Fal', {
        error: error.message,
        stack: error.stack,
        requestId
      });
      throw new Error(`Error getting training results: ${error.message}`);
    }
  }

  async generateImage(input, options = {}) {
    try {
      const modelId = this.config.generation.modelId;
      const loras = input.loras.map(url => ({
        path: url
      }));

      let falInput = {
        loras: loras,
        prompt: input.prompt,
        num_images: input.num_images || this.config.generation.defaultNumOfImage,
        enable_safety_checker: true
      };

      if(input.seed) {
        falInput.seed = input.seed;
      }

      const result = await fal.subscribe(modelId, {
        input: falInput,
        logs: true,
        onQueueUpdate: (update) => {
          if (update.status === "IN_PROGRESS") {
            // update.logs.map((l) => l.message).forEach(console.log);
          }
        },
        ...options
      });
     
      return {
        request_id: result.requestId,
        data: result.data
      };
    } catch (error) {
      console.log(error,'error00')
      log.error('Error submitting image generation to Fal', {
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Error generating image with Fal: ${error.message}`);
    }
  }
}

module.exports = FalAIProvider;
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
        enable_safety_checker: input.enable_safety_checker !== undefined ? input.enable_safety_checker : true
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

  async submitImageGenerationRequest(input, options = {}) {
    try {
      // Use the model ID from options if provided, otherwise use the default from config
      const modelId = options.modelId || this.config.generation.modelId;
      
      let falInput = {
        prompt: input.prompt,
        num_images: input.num_images || this.config.generation.defaultNumOfImage,
        enable_safety_checker: input.enable_safety_checker !== undefined ? input.enable_safety_checker : true
      };

      // Add optional parameters if provided
      if (input.seed) {
        falInput.seed = parseInt(input.seed);
      }
      if (input.num_inference_steps) {
        falInput.num_inference_steps = parseInt(input.num_inference_steps);
      }
      if (input.guidance_scale) {
        falInput.guidance_scale = parseFloat(input.guidance_scale);
      }
      if (input.width) {
        falInput.width = parseInt(input.width);
      }
      if (input.height) {
        falInput.height = parseInt(input.height);
      }
      if (input.output_format) {
        falInput.output_format = input.output_format;
      }

      // Add loras if provided
      if (input.loras && Array.isArray(input.loras)) {
        falInput.loras = input.loras.map(url => ({
          path: url
        }));
      }

      // Add support for image_url input (for edit operations)
      if (input.image_url) {
        if (Array.isArray(input.image_url)) {
          falInput.image_url = input.image_url[0]; // Take the first image if array
        } else {
          falInput.image_url = input.image_url;
        }
      }

      const result = await fal.queue.submit(modelId, {
        input: falInput,
        webhookUrl: options.webhookUrl,
        ...options
      });
console.log(result,'--result')
      log.info('Submitted image generation request to Fal queue', {
        requestId: result.request_id,
        modelId
      });

      return {
        request_id: result.request_id
      };
    } catch (error) {
      const {status, body} = error;

      log.error('Error submitting image generation request to Fal queue', {
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Error submitting image generation request to Fal queue: ${error.message}, Status: ${status}, Body: ${JSON.stringify(body)}`);
    }
  }

  async checkImageGenerationStatus(requestId, options = {}) {
    try {
      // Use model ID from options if provided, otherwise use the default
      const modelId = options.modelId || this.config.generation.modelId;

      const status = await fal.queue.status(modelId, {
        requestId,
        logs: true
      });
      
      log.info('Retrieved image generation status from Fal', {
        requestId,
        status
      });

      return {
        status: status.status,
        logs: status.logs || [],
        progress: status.progress || 0
      };
    } catch (error) {
      log.error('Error checking image generation status with Fal', {
        error: error.message,
        stack: error.stack,
        requestId
      });
      throw new Error(`Error checking image generation status: ${error.message}`);
    }
  }

  async getImageGenerationResult(requestId, options = {}) {
    try {
      // Use model ID from options if provided, otherwise use the default
      const modelId = options.modelId || this.config.generation.modelId;

      const result = await fal.queue.result(modelId, {
        requestId
      });

      log.info('Retrieved image generation results from Fal', {
        requestId,
        result
      });

      return {
        status: 'completed',
        data: result.data
      };
    } catch (error) {
      log.error('Error getting image generation results from Fal', {
        error: error.message,
        stack: error.stack,
        requestId
      });
      throw new Error(`Error getting image generation results: ${error.message}`);
    }
  }

}

module.exports = FalAIProvider;
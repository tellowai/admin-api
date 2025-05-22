'use strict';

/**
 * Kafka topics configuration
 * @constant {Object}
 */
const env = process.env.NODE_ENV || 'dev';

const TOPICS = {
  // command type
  ADMIN_COMMAND_CREATE_ACTIVITY_LOG: `${env}.admin.command.create_activity_log`,
  PROJECT_COMMAND_CREATE_DEFAULT_PROJECT: `${env}.project.command.create_default_project`,
  GENERATION_COMMAND_PHOTO: `${env}.generation.command.generate_photos`,
  MODEL_TUNING_COMMAND_START_PHOTO_TUNING: `${env}.model_tuning.command.start_photo_tuning`,
  MODEL_TUNING_COMMAND_PHOTO_TUNE_POST_PROCESS: `${env}.model_tuning.command.start_photo_tuning_post_process`,
  GENERATION_COMMAND_PHOTO_GENERATION_POST_PROCESS: `${env}.model_tuning.command.start_photo_generation_post_process`,
  USER_CHARACTER_COMMAND_SET_THUMB: `${env}.user_character.command.set_thumb`,
  GENERATION_COMMAND_START_COUPLE_INPAINTING: `${env}.generation.command.start_couple_inpainting`,
  GENERATION_COMMAND_GENERATE_TEXT_TO_IMAGE: `${env}.generation.command.generate_image_from_text`,
  GENERATION_COMMAND_IMAGE_GENERATION_POST_PROCESS: `${env}.generation.command.start_image_generation_post_process`,

  // event type
  AUTH_EVENT_SIGNED_UP: `${env}.auth.event.signed_up`,
  AUTH_EVENT_LOGGED_IN: `${env}.auth.event.logged_in`,
  USER_EVENT_MOBILE_VERIFIED: `${env}.user.event.mobile_connected`,
  USER_EVENT_PROFILE_UPDATED: `${env}.user.event.profile_updated`,
  PROJECT_EVENT_CREATED: `${env}.project.event.project_created`,
  MODEL_TUNING_EVENT_PHOTO_TUNING_COMPLETED: `${env}.model_tuning.event.photo_tuning_completed`,
  GENERATION_EVENT_REQUEST_SUBMITTED_FOR_IMAGE_GENERATION: `${env}.generation.event.image_generation_request_submitted`

};


module.exports = {
  TOPICS
};

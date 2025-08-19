'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const CharacterModel = require('../models/character.model');
const CharacterErrorHandler = require('../middlewares/character.error.handler');
const PaginationCtrl = require('../../core/controllers/pagination.controller');
const logger = require('../../../config/lib/logger');
const StorageFactory = require('../../os2/providers/storage.factory');
const { createId } = require('@paralleldrive/cuid2');
const googlePhoneNumberValidator = require('../../user/validators/google.lib.phonenumber.validator');
const random = require('random').default;
const kafkaCtrl = require('../../core/controllers/kafka.controller');
const { TOPICS } = require('../../core/constants/kafka.events.config');

/**
 * @api {post} /characters Create a new character
 * @apiVersion 1.0.0
 * @apiName CreateCharacter
 * @apiGroup Characters
 * @apiPermission JWT
 *
 * @apiBody {String} character_name Name of the character
 * @apiBody {String} [character_gender] Gender of the character
 * @apiBody {String} [character_description] Description of the character
 * @apiBody {String} [thumb_cf_r2_key] R2 key for thumbnail
 * @apiBody {String} [thumb_cf_r2_url] R2 URL for thumbnail
 */
exports.createUserCharacter = async function(req, res) {
  try {
    let characterData = req.validatedBody;
    const adminId = req.user.userId;

    characterData.user_character_id = createId();
    
    // Set user_id to NULL and created_by_admin_id to adminId for admin-created characters
    characterData.user_id = null;
    characterData.created_by_admin_id = adminId;

    if (characterData.trigger_word) {
      characterData.trigger_word = characterData.trigger_word.toLowerCase();
    } else {
      const triggerWordName = characterData.character_name.slice(0, 205).replace(/[^a-zA-Z0-9]/g, '');
      
      const randomNumber = random.int(100, 999);
      characterData.trigger_word = `${triggerWordName}_${randomNumber}`;
      characterData.trigger_word = characterData.trigger_word.toLowerCase();
    }

    if(characterData.character_type && characterData.character_type == 'couple') {
      characterData.character_gender = 'couple';
    }

    await CharacterModel.createUserCharacter(characterData);

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: adminId,
          entity_type: 'CHARACTERS',
          action_name: 'CREATE_CHARACTER', 
          entity_id: characterData.user_character_id
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.CREATED).json({
      user_character_id: characterData.user_character_id,
      message: req.t('character:CHARACTER_CREATED_SUCCESSFULLY')
    });

  } catch (error) {
    logger.error('Error creating character:', { error: error.message, stack: error.stack });
    CharacterErrorHandler.handleCharacterErrors(error, res);
  }
};

exports.createManualCharacter = async function(req, res) {
  try {
    let characterData = req.validatedBody;
    const adminId = req.user.userId;

    characterData.user_character_id = createId();
    
    // Set user_id to NULL and created_by_admin_id to adminId for admin-created characters
    characterData.user_id = null;
    characterData.created_by_admin_id = adminId;

    // Ensure trigger_word is lowercase
    characterData.trigger_word = characterData.trigger_word.toLowerCase();

    // Handle couple type gender
    if(characterData.character_type && characterData.character_type == 'couple') {
      characterData.character_gender = 'couple';
    }

    // Clean characterData to only include fields that exist in user_characters table
    const cleanCharacterData = {
      user_character_id: characterData.user_character_id,
      character_name: characterData.character_name,
      character_type: characterData.character_type,
      character_gender: characterData.character_gender,
      character_description: characterData.character_description,
      trigger_word: characterData.trigger_word,
      thumb_cf_r2_key: characterData.thumb_cf_r2_key,
      thumb_cf_r2_url: characterData.thumb_cf_r2_url,
      user_id: characterData.user_id,
      created_by_admin_id: characterData.created_by_admin_id,
      training_status: 'completed'
    };

    // Create character in user_characters table (includes thumb_cf_r2_key and thumb_cf_r2_url)
    await CharacterModel.createUserCharacter(cleanCharacterData);

    // Prepare media files data for insertion (only lora weights and config, not thumbnail)
    const mediaFiles = [
      {
        media_id: createId(),
        user_character_id: characterData.user_character_id,
        user_id: null,
        created_by_admin_id: adminId,
        cf_r2_key: characterData.lora_weights_key,
        cf_r2_bucket: characterData.lora_weights_bucket,
        cf_r2_url: characterData.lora_weights_url,
        tag: 'lora_weights',
        media_type: 'safetensors',
        is_auto_generated: 0
      },
      {
        media_id: createId(),
        user_character_id: characterData.user_character_id,
        user_id: null,
        created_by_admin_id: adminId,
        cf_r2_key: characterData.lora_config_key,
        cf_r2_bucket: characterData.lora_config_bucket,
        cf_r2_url: characterData.lora_config_url,
        tag: 'lora_config',
        media_type: 'json',
        is_auto_generated: 0
      }
    ];

    // Insert media files
    await CharacterModel.createMediaFiles(mediaFiles);

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: adminId,
          entity_type: 'CHARACTERS',
          action_name: 'CREATE_MANUAL_CHARACTER', 
          entity_id: characterData.user_character_id
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.CREATED).json({
      user_character_id: characterData.user_character_id,
      message: req.t('character:CHARACTER_CREATED_SUCCESSFULLY')
    });

  } catch (error) {
    logger.error('Error creating manual character:', { error: error.message, stack: error.stack });
    CharacterErrorHandler.handleCharacterErrors(error, res);
  }
};

/**
 * @api {get} /characters List all characters
 * @apiVersion 1.0.0
 * @apiName ListCharacters
 * @apiGroup Characters
 * @apiPermission JWT
 *
 * @apiQuery {Number} [page=1] Page number
 * @apiQuery {Number} [limit=10] Items per page
 */
exports.listUserCharacters = async function(req, res) {
  try {
    const paginationParams = PaginationCtrl.getPaginationParams(req.query);
    const characters = await CharacterModel.listAdminUserCharacters(paginationParams);

    // Get storage provider for presigned URLs
    if (characters.length) {
      const storage = StorageFactory.getProvider();
      
      // Get character IDs to fetch media files
      const characterIds = characters.map(char => char.user_character_id);
      
      // Fetch LoRA weights and config files for all characters
      const mediaFiles = await CharacterModel.getCharacterMediaFiles(characterIds);
      
      // Group media files by character ID
      const mediaFilesByCharacter = {};
      mediaFiles.forEach(file => {
        if (!mediaFilesByCharacter[file.user_character_id]) {
          mediaFilesByCharacter[file.user_character_id] = {};
        }
        mediaFilesByCharacter[file.user_character_id][file.tag] = {
          cf_r2_key: file.cf_r2_key,
          cf_r2_bucket: file.cf_r2_bucket,
          cf_r2_url: file.cf_r2_url,
          media_type: file.media_type,
          download_url: null // Will be populated with presigned URL
        };
      });
      
      // Generate presigned URLs for thumbnails and media files
      await Promise.all(characters.map(async (character) => {
        // Generate presigned URL for thumbnail
        if (character.thumb_cf_r2_key) {
          character.thumb_url = await storage.generatePresignedDownloadUrl(character.thumb_cf_r2_key);
        }
        
        // Generate presigned URLs for LoRA files if they exist
        if (mediaFilesByCharacter[character.user_character_id]) {
          const characterMedia = mediaFilesByCharacter[character.user_character_id];
          
          if (characterMedia.lora_weights) {
            // Use direct URL for public bucket, generate presigned URL for other buckets
            if (characterMedia.lora_weights.cf_r2_bucket === 'public') {
              characterMedia.lora_weights.download_url = await storage.generatePublicBucketPresignedDownloadUrl(characterMedia.lora_weights.cf_r2_key);
            } else {
              characterMedia.lora_weights.download_url = await storage.generatePresignedDownloadUrl(characterMedia.lora_weights.cf_r2_key);
            }
          }
          
          if (characterMedia.lora_config) {
            // Use direct URL for public bucket, generate presigned URL for other buckets
            if (characterMedia.lora_config.cf_r2_bucket === 'public') {
              characterMedia.lora_config.download_url = await storage.generatePublicBucketPresignedDownloadUrl(characterMedia.lora_config.cf_r2_key);
            } else {
              characterMedia.lora_config.download_url = await storage.generatePresignedDownloadUrl(characterMedia.lora_config.cf_r2_key);
            }
          }
          
          // Add media files to character response
          character.media_files = characterMedia;
        }
      }));
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: characters
    });

  } catch (error) {
    logger.error('Error listing characters:', { error: error.message, stack: error.stack });
    CharacterErrorHandler.handleCharacterErrors(error, res);
  }
};

/**
 * @api {get} /users/characters/all List all user characters
 * @apiVersion 1.0.0
 * @apiName ListAllUserCharacters
 * @apiGroup Characters
 * @apiPermission JWT
 */
exports.listAllUserCharacters = async function(req, res) {
  try {
    const userId = req.user.userId;
    const characters = await CharacterModel.listAllAdminCharacters(userId);

    // Get storage provider for presigned URLs
    if (characters.length) {
      const storage = StorageFactory.getProvider();
      
      // Get character IDs to fetch media files
      const characterIds = characters.map(char => char.user_character_id);
      
      // Fetch LoRA weights and config files for all characters
      const mediaFiles = await CharacterModel.getCharacterMediaFiles(characterIds);
      
      // Group media files by character ID
      const mediaFilesByCharacter = {};
      mediaFiles.forEach(file => {
        if (!mediaFilesByCharacter[file.user_character_id]) {
          mediaFilesByCharacter[file.user_character_id] = {};
        }
        mediaFilesByCharacter[file.user_character_id][file.tag] = {
          cf_r2_key: file.cf_r2_key,
          cf_r2_bucket: file.cf_r2_bucket,
          cf_r2_url: file.cf_r2_url,
          media_type: file.media_type,
          download_url: null // Will be populated with presigned URL
        };
      });
      
      // Generate presigned URLs for thumbnails and media files
      await Promise.all(characters.map(async (character) => {
        // Generate presigned URL for thumbnail
        if (character.thumb_cf_r2_key) {
          character.thumb_url = await storage.generatePresignedDownloadUrl(character.thumb_cf_r2_key);
        }
        
        // Generate presigned URLs for LoRA files if they exist
        if (mediaFilesByCharacter[character.user_character_id]) {
          const characterMedia = mediaFilesByCharacter[character.user_character_id];
          
          if (characterMedia.lora_weights) {
            // Use direct URL for public bucket, generate presigned URL for other buckets
            if (characterMedia.lora_weights.cf_r2_bucket === 'public') {
              characterMedia.lora_weights.download_url = characterMedia.lora_weights.cf_r2_url;
            } else {
              characterMedia.lora_weights.download_url = await storage.generatePresignedDownloadUrl(characterMedia.lora_weights.cf_r2_key);
            }
          }
          
          if (characterMedia.lora_config) {
            // Use direct URL for public bucket, generate presigned URL for other buckets
            if (characterMedia.lora_config.cf_r2_bucket === 'public') {
              characterMedia.lora_config.download_url = characterMedia.lora_config.cf_r2_url;
            } else {
              characterMedia.lora_config.download_url = await storage.generatePresignedDownloadUrl(characterMedia.lora_config.cf_r2_key);
            }
          }
          
          // Add media files to character response
          character.media_files = characterMedia;
        }
      }));
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: characters
    });

  } catch (error) {
    logger.error('Error listing all user characters:', { error: error.message, stack: error.stack });
    CharacterErrorHandler.handleCharacterListErrors(error, res);
  }
};

/**
 * @api {patch} /users/characters/:characterId Update character
 * @apiVersion 1.0.0
 * @apiName UpdateUserCharacter
 * @apiGroup Characters
 * @apiPermission JWT
 *
 * @apiParam {String} characterId Character's unique ID
 * 
 * @apiBody {String} [character_name] Name of the character
 * @apiBody {String} [character_gender] Gender of the character
 * @apiBody {String} [character_description] Description of the character
 * @apiBody {String} [thumb_cf_r2_key] R2 key for thumbnail
 * @apiBody {String} [thumb_cf_r2_url] R2 URL for thumbnail
 */
exports.updateUserCharacter = async function(req, res) {
  try {
    const characterId = req.params.characterId;
    const userId = req.user.userId;
    const updateData = req.validatedBody;

    // Verify character access
    const hasAccess = await CharacterModel.verifyCharacterOwnership(characterId, userId);
    
    if (!hasAccess) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('character:CHARACTER_NOT_FOUND_OR_UNAUTHORIZED')
      });
    }

    // Update character
    await CharacterModel.updateUserCharacter(characterId, userId, updateData);

    // Publish activity log command
    await kafkaCtrl.sendMessage(
      TOPICS.ADMIN_COMMAND_CREATE_ACTIVITY_LOG,
      [{
        value: { 
          admin_user_id: userId,
          entity_type: 'CHARACTERS',
          action_name: 'UPDATE_CHARACTER', 
          entity_id: characterId
        }
      }],
      'create_admin_activity_log'
    );

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('character:CHARACTER_UPDATED_SUCCESSFULLY')
    });

  } catch (error) {
    logger.error('Error updating character:', { error: error.message, stack: error.stack });
    CharacterErrorHandler.handleCharacterErrors(error, res);
  }
};

/**
 * @api {get} /users/characters/:characterId Get character details
 * @apiVersion 1.0.0
 * @apiName GetUserCharacter
 * @apiGroup Characters
 * @apiPermission JWT
 *
 * @apiParam {String} characterId Character's unique ID
 */
exports.getUserCharacter = async function(req, res) {
  try {
    const characterId = req.params.characterId;
    const userId = req.user.userId;

    // Verify character ownership
    const hasAccess = await CharacterModel.verifyCharacterOwnership(characterId, userId);
    if (!hasAccess) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('character:CHARACTER_NOT_FOUND_OR_UNAUTHORIZED')
      });
    }

    // Get character data
    const [character] = await CharacterModel.getCharacterData(characterId);
    if (!character) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('character:CHARACTER_NOT_FOUND')
      });
    }

    // Generate presigned URL for thumbnail if exists
    if (character.thumb_cf_r2_key) {
      const storage = StorageFactory.getProvider();
      character.thumb_url = await storage.generatePresignedDownloadUrl(character.thumb_cf_r2_key);
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: character
    });

  } catch (error) {
    logger.error('Error getting character:', { error: error.message, stack: error.stack });
    CharacterErrorHandler.handleCharacterErrors(error, res);
  }
};

/**
 * @api {patch} /users/characters/:characterId/mobile Update character mobile
 * @apiVersion 1.0.0
 * @apiName UpdateCharacterMobile
 * @apiGroup Characters
 * @apiPermission JWT
 *
 * @apiParam {String} characterId Character's unique ID
 * 
 * @apiBody {String} [character_mobile] Mobile number of the character
 */
exports.updateCharacterMobile = async function(req, res) {
  try {
    const characterId = req.params.characterId;
    const userId = req.user.userId;
    const updateData = req.validatedBody;

    // Verify character ownership
    const hasAccess = await CharacterModel.verifyCharacterOwnership(characterId, userId);
    if (!hasAccess) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('character:CHARACTER_NOT_FOUND_OR_UNAUTHORIZED')
      });
    }

    // Validate and normalize mobile number with default country
    const mobile = googlePhoneNumberValidator.normalizeSinglePhoneNumber(updateData.character_mobile);
    if (!mobile) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
          message: req.t('user:INVALID_MOBILE_NUMBER')
      });
    }

    // Update character's mobile number
    await CharacterModel.updateUserCharacter(characterId, userId, updateData);

    // Get user data to check if mobile exists
    const [userData] = await CharacterModel.getUserDataByUserId(userId);
    
    // If user doesn't have a mobile number, update it
    if (!userData?.mobile) {
      CharacterModel.updateUserMobile(userId, mobile)
        .catch(err => logger.error('Error updating user mobile:', { 
          error: err.message, stack: err.stack 
        }));
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      message: req.t('character:CHARACTER_MOBILE_UPDATED_SUCCESSFULLY')
    });

  } catch (error) {
    logger.error('Error updating character mobile:', { error: error.message, stack: error.stack });
    CharacterErrorHandler.handleCharacterErrors(error, res);
  }
}; 
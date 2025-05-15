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
      
      // Generate presigned URLs for thumbnails
      await Promise.all(characters.map(async (character) => {
        if (character.thumb_cf_r2_key) {
          character.thumb_url = await storage.generatePresignedDownloadUrl(character.thumb_cf_r2_key);
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
    const characters = await CharacterModel.listAllUserCharacters(userId);

    // Get storage provider for presigned URLs
    if (characters.length) {
      const storage = StorageFactory.getProvider();
      
      // Generate presigned URLs for thumbnails
      await Promise.all(characters.map(async (character) => {
        if (character.thumb_cf_r2_key) {
          character.thumb_url = await storage.generatePresignedDownloadUrl(character.thumb_cf_r2_key);
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
'use strict';

const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const CharacterMediaModel = require('../models/media.character.model');
const CharacterErrorHandler = require('../middlewares/character.error.handler');
const logger = require('../../../config/lib/logger');
const StorageFactory = require('../../os2/providers/storage.factory');
const { createId } = require('@paralleldrive/cuid2');
const { TOPICS } = require('../../core/constants/kafka.events.config');
const kafkaCtrl = require('../../core/controllers/kafka.controller');

/**
 * @api {post} /users/characters/:characterId/media Upload media to character
 * @apiVersion 1.0.0
 * @apiName UploadMediaToCharacter
 * @apiGroup Characters
 * @apiPermission JWT
 */
exports.uploadMediaToCharacter = async function(req, res) {
  try {
    const characterId = req.params.characterId;
    const adminId = req.user.userId;
    const { media } = req.validatedBody;

    // Verify character exists and is an admin character
    const isAdminCharacter = await CharacterMediaModel.verifyAdminCharacter(characterId);
    if (!isAdminCharacter) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('character:CHARACTER_NOT_FOUND_OR_UNAUTHORIZED')
      });
    }

    // Process each media item
    const mediaPromises = media.map(async (item) => {
      const mediaData = {
        media_id: createId(),
        user_character_id: characterId,
        user_id: null, // Set user_id to null for admin characters
        created_by_admin_id: adminId,
        cf_r2_key: item.cf_r2_key,
        cf_r2_url: item.cf_r2_url,
        media_type: item.media_type
      };

      return CharacterMediaModel.uploadMediaToCharacter(mediaData);
    });

    await Promise.all(mediaPromises);

    // Randomly select one media item
    const randomIndex = Math.floor(Math.random() * media.length);
    const selectedMedia = media[randomIndex];
    const { cf_r2_key, cf_r2_url } = selectedMedia;
    
    const selectedMediaObj = { cf_r2_key, cf_r2_url };

    
    // Publish generation command
    await kafkaCtrl.sendMessage(
      TOPICS.USER_CHARACTER_COMMAND_SET_THUMB,
      [{
        value: {
          user_character_id: characterId,
          thumb_media: selectedMediaObj,
          user_id: null // Null user_id for admin characters
        }
      }],
      'set_user_character_thumb'
    );

    return res.status(HTTP_STATUS_CODES.CREATED).json({
      message: req.t('character:MEDIA_UPLOADED_SUCCESSFULLY')
    });

  } catch (error) {
    logger.error('Error uploading character media:', { error: error.message, stack: error.stack });
    CharacterErrorHandler.handleCharacterMediaErrors(error, res);
  }
};

/**
 * @api {get} /users/characters/:characterId/media List character media
 * @apiVersion 1.0.0
 * @apiName ListCharacterMedia
 * @apiGroup Characters
 * @apiPermission JWT
 */
exports.listCharacterMedia = async function(req, res) {
  try {
    const characterId = req.params.characterId;
    const adminId = req.user.userId;

    // Verify character exists and is an admin character
    const isAdminCharacter = await CharacterMediaModel.verifyAdminCharacter(characterId);
    if (!isAdminCharacter) {
      return res.status(HTTP_STATUS_CODES.NOT_FOUND).json({
        message: req.t('character:CHARACTER_NOT_FOUND_OR_UNAUTHORIZED')
      });
    }

    // Get admin character media (user_id is NULL)
    const media = await CharacterMediaModel.listAdminCharacterMedia(characterId);

    // Generate presigned URLs if media exists
    if (media.length) {
      const storage = StorageFactory.getProvider();
      
      await Promise.all(media.map(async (item) => {
        if (item.cf_r2_key) {
          item.r2_url = await storage.generatePresignedDownloadUrl(item.cf_r2_key);
        }
      }));
    }

    return res.status(HTTP_STATUS_CODES.OK).json({
      data: media
    });

  } catch (error) {
    logger.error('Error listing character media:', { error: error.message, stack: error.stack });
    CharacterErrorHandler.handleCharacterMediaErrors(error, res);
  }
}; 
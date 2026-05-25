'use strict';
const RemoteConfigDbo = require('../models/remote.config.model');
const RemoteConfigErrorHandler = require('../middlewares/remote.config.error.handler');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;


exports.createOrUpdateRemoteConfig = async function (rcData) {
  try {
    const payload = rcData;
    payload.rc_key_name = payload.rc_key_name.toLowerCase();
    if(typeof payload.rc_default_value === 'object') payload.rc_default_value = JSON.stringify(payload.rc_default_value);


    payload.data_type = payload.data_type || 'string';
    payload.rc_value = payload.rc_value || '';
    payload.rc_default_value = payload.rc_default_value || '';

    // Create new remote config
    const rcId = await RemoteConfigDbo.createOrUpdateRemoteConfig(payload);
      
    return rcId;
  } catch (err) {
    console.log(err, "-> rc err")
    err.custom = {
      httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
      message: req.t('remote-config:REMOTE_CONFIG_CREATION_FAILED')
    };

    return err;
  }
};


/**
 * @api {get} /config/system Get All Remote Config System generated Keys and Values
 * @apiName getAllRemoteConfigKeysAndValues
 * @apiGroup RemoteConfig
 *
 * @apiSuccess {Object} data All remote config keys and values.
 * @apiSuccessExample {json} Success-Response:
 *   HTTP/1.1 200 OK
 *   {
 *     "data": [
 *       {
 *         "rc_key_id": 1,
 *         "rc_key_name": "last_share_done_at",
 *         "data_type": "string",
 *         "rc_value": "2024-06-27T07:56:09.999Z",
 *         "created_at": "2024-06-27T07:56:03.858Z",
 *         "updated_at": "2024-06-27T07:56:10.003Z"
 *       }
 *     ]
 *   }
 *
 * @apiError {Object} error Error information.
 * @apiError {Number} error.httpStatusCode HTTP status code.
 * @apiError {String} error.message Error message.
 */
exports.getAllRemoteConfigKeysAndValues = async function (req, res, next) {
  try {
    // Get all remote config keys and default values
    const remoteConfigData = await RemoteConfigDbo.getAllRemoteConfigKeysAndDefaultValues();

    // Send response
    return res.status(HTTP_STATUS_CODES.OK).json({
      data: remoteConfigData
    });

  } catch (err) {

    err.custom = {
      httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
      message: req.t('remote-config:REMOTE_CONFIG_RETRIEVAL_FAILED')
    };

    return RemoteConfigErrorHandler.handleRemoteConfigValuesFetchErrors(err, res);
  }
};

/**
 * Update a single remote config key by name (e.g. for Constants / max_free_generations_per_template).
 * Body: { rc_key_name, value }. Value is stored as string for both rc_value and rc_default_value.
 */
exports.updateRemoteConfigValueByKey = async function (req, res, next) {
  try {
    const { rc_key_name, value, data_type: dataTypeIn } = req.body || {};
    if (!rc_key_name) {
      return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
        message: 'rc_key_name is required'
      });
    }
    const allowedTypes = new Set(['string', 'number', 'boolean', 'json']);
    const data_type = allowedTypes.has(String(dataTypeIn || '').toLowerCase())
      ? String(dataTypeIn).toLowerCase()
      : 'number';
    let strValue = '';
    if (data_type === 'json') {
      if (value === undefined || value === null) strValue = '';
      else if (typeof value === 'object') strValue = JSON.stringify(value);
      else strValue = String(value);
    } else if (data_type === 'boolean') {
      strValue = value === true || value === 'true' || value === '1' ? 'true' : 'false';
    } else {
      strValue = value != null ? String(value) : '';
    }
    const payload = {
      rc_key_name: rc_key_name.toLowerCase(),
      data_type,
      rc_default_value: strValue,
      rc_value: strValue
    };
    await RemoteConfigDbo.createOrUpdateRemoteConfig(payload);
    const overlayCacheKeys = {
      output_logo_overlay_config: ['output_logo_overlay_config_json'],
      free_template_video_logo_config: ['free_template_video_logo_config_json', 'output_logo_overlay_config_json'],
      output_watermark_config: ['output_watermark_config_json'],
      video_outro_config: ['video_outro_config_json']
    };
    const keysToDelete = overlayCacheKeys[payload.rc_key_name];
    if (keysToDelete && keysToDelete.length > 0) {
      try {
        const RedisService = require('../../core/models/redis.promise.model');
        for (const k of keysToDelete) {
          await RedisService.deleteData(k);
        }
      } catch (_) {
        /* non-fatal */
      }
    }
    return res.status(HTTP_STATUS_CODES.OK).json({
      message: 'Updated',
      data: { rc_key_name: payload.rc_key_name, value: strValue, data_type }
    });
  } catch (err) {
    err.custom = {
      httpStatusCode: HTTP_STATUS_CODES.BAD_REQUEST,
      message: req.t('remote-config:REMOTE_CONFIG_CREATION_FAILED')
    };
    return RemoteConfigErrorHandler.handleRemoteConfigValuesFetchErrors(err, res);
  }
};

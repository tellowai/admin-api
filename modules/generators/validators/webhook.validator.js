'use strict';

const crypto = require('crypto');
const config = require('../../../config/config');
const HTTP_STATUS_CODES = require('../../core/controllers/httpcodes.server.controller').CODES;
const EncryptionCtrl = require('../../core/controllers/encryption.controller');

exports.validateFalWebhook = async function(req, res, next) {
  try {
    const encryptedSessionIdHex = req.params.tuningSessionId;

    // Convert hex back to string and decrypt
    const encryptedSessionId = EncryptionCtrl.hexToString(encryptedSessionIdHex);
    const sessionId = EncryptionCtrl.decrypt(encryptedSessionId);
    
    // Add decrypted session ID to request
    req.tuningSessionId = sessionId;
    next();
  } catch (err) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: req.t('generator:INVALID_WEBHOOK_PAYLOAD')
    });
  }
};

exports.validateMiniMaxSubjectRefFalWebhook = async function(req, res, next) {
  try {
    const encryptedGenerationIdHex = req.params.generationId;

    // Convert hex back to string and decrypt
    const encryptedGenerationId = EncryptionCtrl.hexToString(encryptedGenerationIdHex);
    const generationId = EncryptionCtrl.decrypt(encryptedGenerationId);
    
    // Add decrypted generation ID to request
    req.generationId = generationId;
    next();
  } catch (err) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: req.t('generator:INVALID_WEBHOOK_PAYLOAD')
    });
  }
}; 

exports.validateFalImageGenWebhook = async function(req, res, next) {
  try {
    const encryptedGenerationIdHex = req.params.generationId;

    // Convert hex back to string and decrypt
    const encryptedGenerationId = EncryptionCtrl.hexToString(encryptedGenerationIdHex);
    const generationId = EncryptionCtrl.decrypt(encryptedGenerationId);
    
    // Add decrypted generation ID to request
    req.generationId = generationId;
    next();
  } catch (err) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: req.t('generator:INVALID_WEBHOOK_PAYLOAD')
    });
  }
}; 

exports.validateFalUpscaleWebhook = async function(req, res, next) {
  try {
    const encryptedGenerationIdHex = req.params.upscaleGenerationId;

    // Convert hex back to string and decrypt
    const encryptedGenerationId = EncryptionCtrl.hexToString(encryptedGenerationIdHex);
    const generationId = EncryptionCtrl.decrypt(encryptedGenerationId);
    
    // Add decrypted generation ID to request
    req.generationId = generationId;
    next();
  } catch (err) {
    return res.status(HTTP_STATUS_CODES.BAD_REQUEST).json({
      message: req.t('generator:INVALID_WEBHOOK_PAYLOAD')
    });
  }
}; 
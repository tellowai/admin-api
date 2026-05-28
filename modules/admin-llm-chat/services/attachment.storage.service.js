'use strict';

const config = require('../../../config/config');
const StorageFactory = require('../../os2/providers/storage.factory');
const CONSTANTS = require('../constants/admin-llm-chat.constants');

function normalizeKey(key) {
  return String(key || '').replace(/^\/+/, '');
}

function buildStorageKey(conversationId, attachmentId, extension) {
  const ext = extension ? `.${String(extension).replace(/^\./, '')}` : '';
  return `${CONSTANTS.ATTACHMENT_STORAGE_PREFIX}${conversationId}/${attachmentId}${ext}`;
}

function isAllowedStorageKey(storageKey, { conversationId, attachmentId }) {
  const clean = normalizeKey(storageKey);
  const prefix = `${CONSTANTS.ATTACHMENT_STORAGE_PREFIX}${conversationId}/${attachmentId}`;
  return clean === prefix || clean.startsWith(`${prefix}.`);
}

async function presignPublicUpload({ conversationId, attachmentId, contentType, extension }) {
  const storage = StorageFactory.getProvider();
  const storageKey = buildStorageKey(conversationId, attachmentId, extension);
  const signedUrl = await storage.generatePresignedPublicBucketUploadUrl(storageKey, {
    contentType,
    metadata: { conversationId, attachmentId, purpose: 'admin_llm_chat_attachment' },
    expiresIn: config.os2?.upload?.expiresIn,
  });

  const cleanKey = normalizeKey(storageKey);
  const bucketBase = String(config.os2?.r2?.public?.bucketUrl || '').replace(/\/$/, '');
  const publicUrl = bucketBase ? `${bucketBase}/${cleanKey}` : signedUrl.split('?')[0];

  return {
    attachment_id: attachmentId,
    storage_key: cleanKey,
    signed_url: signedUrl,
    public_url: publicUrl,
    bucket: 'public',
  };
}

function publicUrlForKey(storageKey) {
  const clean = normalizeKey(storageKey);
  const bucketBase = String(config.os2?.r2?.public?.bucketUrl || '').replace(/\/$/, '');
  if (!bucketBase) return clean;
  return `${bucketBase}/${clean}`;
}

async function fetchPublicObjectBuffer(storageKey) {
  const url = publicUrlForKey(storageKey);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch attachment from storage (${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function deletePublicObject(storageKey) {
  if (!storageKey) return;
  const storage = StorageFactory.getProvider();
  await storage.deleteObjectFromBucket('public', storageKey);
}

async function deleteStorageKeys(storageKeys) {
  await Promise.all((storageKeys || []).map((key) => deletePublicObject(key).catch(() => {})));
}

module.exports = {
  buildStorageKey,
  isAllowedStorageKey,
  publicUrlForKey,
  presignPublicUpload,
  fetchPublicObjectBuffer,
  deletePublicObject,
  deleteStorageKeys,
};

'use strict';

const StorageFactory = require('../../os2/providers/storage.factory');

/**
 * Resolve a displayable profile picture URL for admin UIs.
 * Presigns S3 asset keys; leaves external http(s) URLs unchanged.
 * @param {object|null|undefined} userRow
 * @param {import('../../os2/providers/storage.factory')} [storage]
 * @returns {Promise<string|null>}
 */
async function resolveEndUserProfilePicUrl(userRow, storage = null) {
  if (!userRow) return null;
  const provider = storage || StorageFactory.getProvider();
  let profilePicUrl = userRow.profile_pic || null;
  const profilePicAssetKey = userRow.profile_pic_asset_key;
  const profilePicBucket = userRow.profile_pic_bucket;

  if (profilePicAssetKey) {
    try {
      if (profilePicBucket && profilePicBucket.includes('ephemeral')) {
        profilePicUrl = await provider.generateEphemeralPresignedDownloadUrl(profilePicAssetKey, {
          expiresIn: 3600
        });
      } else {
        profilePicUrl = await provider.generatePresignedDownloadUrl(profilePicAssetKey, {
          expiresIn: 3600
        });
      }
    } catch (e) {
      console.error('consumer user profile presign failed:', e.message);
    }
  } else if (profilePicUrl && !String(profilePicUrl).startsWith('http')) {
    try {
      profilePicUrl = await provider.generatePresignedDownloadUrl(profilePicUrl, { expiresIn: 3600 });
    } catch (e) {
      console.error('consumer user profile presign fallback failed:', e.message);
    }
  }

  return profilePicUrl;
}

/**
 * @param {object|null|undefined} userRow
 * @returns {Promise<{ display_name: string|null, email: string|null, mobile: string|null, profile_pic: string|null }|null>}
 */
async function buildEndUserDetailsForAdmin(userRow) {
  if (!userRow) return null;
  return {
    display_name: userRow.display_name ?? null,
    email: userRow.email ?? null,
    mobile: userRow.mobile ?? null,
    profile_pic: await resolveEndUserProfilePicUrl(userRow)
  };
}

/**
 * @param {Array<object>} userRows
 * @returns {Promise<Record<string, object>>}
 */
async function buildEndUserDetailsMapForAdmin(userRows) {
  const entries = await Promise.all(
    (userRows || []).map(async (u) => [u.user_id, await buildEndUserDetailsForAdmin(u)])
  );
  return Object.fromEntries(entries);
}

module.exports = {
  resolveEndUserProfilePicUrl,
  buildEndUserDetailsForAdmin,
  buildEndUserDetailsMapForAdmin
};

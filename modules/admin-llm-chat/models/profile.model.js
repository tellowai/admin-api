'use strict';

const mysqlModel = require('../../core/models/mysql.promise.model');

const DEFAULT_PROFILE = {
  preferred_metrics: [],
  focus_channels: [],
  currency: null,
  default_date_range: null,
  reporting_notes: null,
};

function isSchemaMismatchError(err) {
  const msg = String(err?.originalMessage || err?.message || '');
  return msg.includes('Unknown column') || msg.includes("doesn't exist");
}

exports.getByUser = async (userId) => {
  const q = `SELECT profile_json FROM admin_llm_chat_user_profiles WHERE user_id = ? LIMIT 1`;
  try {
    const rows = await mysqlModel.runQueryInSlave(q, [userId]);
    if (!rows[0]?.profile_json) return { ...DEFAULT_PROFILE };
    const parsed = typeof rows[0].profile_json === 'string'
      ? JSON.parse(rows[0].profile_json)
      : rows[0].profile_json;
    return { ...DEFAULT_PROFILE, ...parsed };
  } catch (err) {
    if (isSchemaMismatchError(err)) return { ...DEFAULT_PROFILE };
    throw err;
  }
};

exports.upsert = async (userId, profileJson) => {
  const q = `INSERT INTO admin_llm_chat_user_profiles (user_id, profile_json)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE profile_json = VALUES(profile_json), updated_at = NOW()`;
  try {
    return await mysqlModel.runQueryInMaster(q, [userId, JSON.stringify(profileJson)]);
  } catch (err) {
    if (isSchemaMismatchError(err)) return null;
    throw err;
  }
};

exports.purgeForUser = async (userId) => {
  const q = `DELETE FROM admin_llm_chat_user_profiles WHERE user_id = ?`;
  try {
    return await mysqlModel.runQueryInMaster(q, [userId]);
  } catch (err) {
    if (isSchemaMismatchError(err)) return null;
    throw err;
  }
};

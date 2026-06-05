'use strict';

const ProfileModel = require('../models/profile.model');

const PROFILE_KEY_MAP = {
  preferred_currency: 'currency',
  currency: 'currency',
  focus_channel: 'focus_channels',
  focus_channels: 'focus_channels',
  default_date_range: 'default_date_range',
  preferred_metrics: 'preferred_metrics',
  reporting_notes: 'reporting_notes',
};

function applyFactToProfile(profile, key, value) {
  const field = PROFILE_KEY_MAP[key] || null;
  if (!field) return false;
  if (field === 'focus_channels' || field === 'preferred_metrics') {
    const existing = Array.isArray(profile[field]) ? profile[field] : [];
    const val = String(value).trim();
    if (val && !existing.includes(val)) {
      profile[field] = [...existing, val].slice(-10);
      return true;
    }
    return false;
  }
  if (profile[field] !== value) {
    profile[field] = value;
    return true;
  }
  return false;
}

function mergeFactIntoProfile(userId, key, value) {
  return mergeFactsIntoProfile(userId, [{ key, value }]);
}

/** Single read + in-memory merge + one write — no query per fact. */
async function mergeFactsIntoProfile(userId, facts) {
  if (!facts?.length) return ProfileModel.getByUser(userId);
  const profile = await ProfileModel.getByUser(userId);
  const next = { ...profile };
  let changed = false;
  facts.forEach(({ key, value }) => {
    if (applyFactToProfile(next, key, value)) changed = true;
  });
  if (changed) await ProfileModel.upsert(userId, next);
  return next;
}

async function getProfileForUser(userId) {
  return ProfileModel.getByUser(userId);
}

async function updateProfile(userId, profileJson) {
  await ProfileModel.upsert(userId, profileJson);
  return ProfileModel.getByUser(userId);
}

module.exports = {
  mergeFactIntoProfile,
  mergeFactsIntoProfile,
  getProfileForUser,
  updateProfile,
};

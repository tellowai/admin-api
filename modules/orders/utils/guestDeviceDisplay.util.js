'use strict';

/** Admin label for purchases anchored to a mobile device before sign-in. */
const GUEST_DEVICE_LABEL = 'Guest device';

function normalizeDeviceId(deviceId) {
  return deviceId != null ? String(deviceId).trim() : '';
}

/** Short suffix for list rows (last 8 chars). */
function guestDeviceShortSuffix(deviceId) {
  const id = normalizeDeviceId(deviceId);
  if (!id) return '';
  return id.length > 8 ? id.slice(-8) : id;
}

/** Primary display name for guest device purchasers in admin tables. */
function formatGuestDeviceDisplayName(deviceId) {
  const id = normalizeDeviceId(deviceId);
  if (!id) return GUEST_DEVICE_LABEL;
  const suffix = guestDeviceShortSuffix(id);
  return suffix && suffix !== id ? `${GUEST_DEVICE_LABEL} · ${suffix}` : GUEST_DEVICE_LABEL;
}

module.exports = {
  GUEST_DEVICE_LABEL,
  guestDeviceShortSuffix,
  formatGuestDeviceDisplayName,
  normalizeDeviceId
};

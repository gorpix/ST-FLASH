export const MODULE_NAME = 'st_flash';
export const DISPLAY_NAME = 'ST-FLASH';
export const PROTOCOL_VERSION = 1;

export const ROLE_KEYS = Object.freeze({
  ANCHOR: 'anchor',
  CAPSULE: 'capsule',
  FLASH: 'flash',
  LANDING: 'landing',
  CONTINUATION: 'continuation',
});

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  landingBaselineMessages: 5,
  // Kimi's visible capsule can be ~1,200 tokens after a sizeable reasoning
  // block. This is a ceiling, not a requested output length; leave enough
  // room for the model to reach its final structured answer.
  capsuleResponseLength: 3200,
  profiles: {
    anchor: '',
    flash: '',
    landing: '',
  },
  presets: {
    anchor: 'FF5.2 Anchor',
    capsule: 'Capsule',
    flash: 'FF5.2 Flash',
    landing: 'FF5.2 Landing',
    continuation: 'FF5.2 Continuation',
  },
});

export const ROLE_CONFIG = Object.freeze({
  [ROLE_KEYS.ANCHOR]: { profileKey: 'anchor', presetKey: 'anchor' },
  [ROLE_KEYS.CAPSULE]: { profileKey: 'flash', presetKey: 'capsule' },
  [ROLE_KEYS.FLASH]: { profileKey: 'flash', presetKey: 'flash' },
  [ROLE_KEYS.LANDING]: { profileKey: 'landing', presetKey: 'landing' },
  [ROLE_KEYS.CONTINUATION]: { profileKey: 'landing', presetKey: 'continuation' },
});

export const INJECTION_KEYS = Object.freeze({
  CAPSULE: 'st_flash_capsule',
  DELTAS: 'st_flash_deltas',
  CONTROL: 'st_flash_control',
});

export function mergeSettings(stored = {}) {
  const storedCapsuleLength = Number(stored.capsuleResponseLength);
  const capsuleResponseLength = Number.isFinite(storedCapsuleLength) && storedCapsuleLength > 1800
    ? storedCapsuleLength
    : DEFAULT_SETTINGS.capsuleResponseLength;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    capsuleResponseLength,
    profiles: { ...DEFAULT_SETTINGS.profiles, ...(stored.profiles ?? {}) },
    presets: { ...DEFAULT_SETTINGS.presets, ...(stored.presets ?? {}) },
  };
}

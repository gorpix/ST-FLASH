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
  capsuleResponseLength: 1800,
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
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    profiles: { ...DEFAULT_SETTINGS.profiles, ...(stored.profiles ?? {}) },
    presets: { ...DEFAULT_SETTINGS.presets, ...(stored.presets ?? {}) },
  };
}

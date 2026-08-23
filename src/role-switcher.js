/**
 * Role and preset switching for ST-FLASH.
 *
 * SillyTavern applies a Connection Manager profile before a completion preset
 * is selected.  This adapter keeps that ordering explicit and makes every
 * external dependency injectable so the controller can be tested without a
 * running SillyTavern window.
 */

export const ROLE_NAMES = Object.freeze([
    'anchor',
    'capsule',
    'flash',
    'landing',
    'continuation',
]);

/**
 * Preset names are intentionally exact. Profile IDs are installation-local
 * and must be configured by the user rather than guessed or embedded here.
 */
export const DEFAULT_ROLE_CONFIG = Object.freeze({
    anchor: Object.freeze({ profileId: '', presetName: 'FF5.2 Anchor' }),
    capsule: Object.freeze({ profileId: '', presetName: 'Capsule' }),
    flash: Object.freeze({ profileId: '', presetName: 'FF5.2 Flash' }),
    landing: Object.freeze({ profileId: '', presetName: 'FF5.2 Landing' }),
    continuation: Object.freeze({ profileId: '', presetName: 'FF5.2 Continuation' }),
});

const DEFAULT_TIMEOUT_MS = 15_000;

export class RoleSwitchError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'RoleSwitchError';
        this.code = details.code || 'ROLE_SWITCH_FAILED';
        this.role = details.role;
        this.phase = details.phase;
        this.cause = details.cause;
    }
}

function asNonEmptyString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function clonePlain(value) {
    if (value === undefined) return undefined;
    try {
        return structuredClone(value);
    } catch {
        return value && typeof value === 'object' ? { ...value } : value;
    }
}

function getProfileManagerState(context) {
    const manager = context?.extensionSettings?.connectionManager;
    if (!manager || !Array.isArray(manager.profiles)) {
        throw new RoleSwitchError('Connection Manager is unavailable or has no profiles.', {
            code: 'PROFILE_MANAGER_UNAVAILABLE',
        });
    }
    return manager;
}

function findProfile(manager, profileId) {
    if (!profileId) return null;
    return manager.profiles.find((profile) => profile?.id === profileId) || null;
}

function getCurrentProfile(context) {
    const manager = context?.extensionSettings?.connectionManager;
    if (!manager) return null;
    return findProfile(manager, manager.selectedProfile);
}

function getPresetName(presetManager) {
    if (!presetManager) return '';
    if (typeof presetManager.getSelectedPresetName === 'function') {
        return asNonEmptyString(presetManager.getSelectedPresetName());
    }
    if (typeof presetManager.getSelectedPreset === 'function') {
        return asNonEmptyString(presetManager.getSelectedPreset());
    }
    return '';
}

function getEffectiveModel(context, profile) {
    const settings = context?.chatCompletionSettings || context?.oaiSettings || context?.oai_settings || {};
    // Custom is the active model field for the user's current custom endpoint;
    // model is used by the native OpenAI source. Empty values are ignored.
    const active = [settings.custom_model, settings.model, settings.customModel]
        .map(asNonEmptyString)
        .find(Boolean);
    return active || asNonEmptyString(profile?.model);
}

function waitForEvent(eventSource, eventName, timeoutMs, label) {
    if (!eventSource || typeof eventSource.on !== 'function' || !eventName) {
        throw new RoleSwitchError(`Cannot await ${label}: SillyTavern event source is unavailable.`, {
            code: 'EVENT_SOURCE_UNAVAILABLE',
        });
    }

    let timer;
    let settled = false;
    let listener;

    const promise = new Promise((resolve, reject) => {
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            if (typeof eventSource.removeListener === 'function' && listener) {
                eventSource.removeListener(eventName, listener);
            }
            callback(value);
        };

        listener = (...args) => finish(resolve, args.length <= 1 ? args[0] : args);
        eventSource.on(eventName, listener);

        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            timer = setTimeout(() => finish(reject, new RoleSwitchError(`Timed out waiting for ${label}.`, {
                code: 'EVENT_TIMEOUT',
            })), timeoutMs);
        }
    });

    return promise;
}

function waitForOnlineStatus({ context, eventSource, eventTypes, timeoutMs }) {
    const status = context?.onlineStatus;
    if (typeof status === 'string' && status !== 'no_connection') return Promise.resolve(status);

    const eventName = eventTypes?.ONLINE_STATUS_CHANGED;
    if (!eventSource || typeof eventSource.on !== 'function' || !eventName) {
        // Some compatible hosts do not expose online status. Profile-loaded
        // remains the strongest available readiness signal in that case.
        return Promise.resolve(status);
    }

    let timer;
    let settled = false;
    let listener;
    return new Promise((resolve, reject) => {
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            if (typeof eventSource.removeListener === 'function' && listener) eventSource.removeListener(eventName, listener);
            callback(value);
        };

        listener = (nextStatus) => {
            if (nextStatus !== 'no_connection') finish(resolve, nextStatus);
        };
        eventSource.on(eventName, listener);
        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            timer = setTimeout(() => finish(reject, new RoleSwitchError('Timed out waiting for the API connection.', {
                code: 'CONNECTION_TIMEOUT',
            })), timeoutMs);
        }
    });
}

function makeDomEvent(documentRef) {
    if (typeof Event === 'function') return new Event('change', { bubbles: true });
    return documentRef?.createEvent?.('Event') && (() => {
        const event = documentRef.createEvent('Event');
        event.initEvent('change', true, true);
        return event;
    })();
}

/**
 * Initiate profile selection without waiting for the event. The caller must
 * install the event waiter first to avoid racing SillyTavern's change handler.
 */
async function defaultSelectProfile(profile, { context, documentRef }) {
    const select = documentRef?.getElementById?.('connection_profiles');
    if (select) {
        const option = Array.from(select.options || []).find((item) => item.value === profile?.id);
        if (!option && profile?.id) {
            throw new RoleSwitchError(`Connection profile is not present in the selector: ${profile.id}`, {
                code: 'PROFILE_NOT_IN_SELECTOR',
            });
        }
        select.value = profile?.id || '';
        const event = makeDomEvent(documentRef);
        if (!event) throw new RoleSwitchError('Cannot dispatch a profile selection event.', { code: 'DOM_UNAVAILABLE' });
        select.dispatchEvent(event);
        return;
    }

    // Headless tests or a future ST UI may not expose the select element. The
    // slash command is a supported fallback; profile names are resolved by
    // Connection Manager rather than interpolating an untrusted profile ID.
    if (profile?.name && typeof context?.executeSlashCommandsWithOptions === 'function') {
        await context.executeSlashCommandsWithOptions(`/profile ${profile.name}`, {
            handleExecutionErrors: false,
        });
        return;
    }

    throw new RoleSwitchError('Connection Manager profile selector is unavailable.', {
        code: 'PROFILE_SELECTOR_UNAVAILABLE',
    });
}

/**
 * @typedef {object} RoleSwitcherOptions
 * @property {Function} [getContext] Returns the current SillyTavern context.
 * @property {Function} [getPresetManager] Returns the OpenAI preset manager.
 * @property {object} [eventSource] SillyTavern EventEmitter instance.
 * @property {object} [eventTypes] SillyTavern event type constants.
 * @property {object} [documentRef] Browser document (injectable for tests).
 * @property {object} [roles] Role-to-profile/preset mapping.
 * @property {number} [timeoutMs] Event wait timeout.
 * @property {Function} [selectProfile] Profile selection initiator.
 * @property {Function} [selectPreset] Preset selection initiator.
 * @property {Function} [waitForConnection] Optional provider readiness hook.
 */

export class RoleSwitcher {
    constructor(options = {}) {
        this.getContext = options.getContext || (() => globalThis.SillyTavern?.getContext?.());
        this.getPresetManager = options.getPresetManager || ((apiId = 'openai') => this.getContext()?.getPresetManager?.(apiId));
        this.eventSource = options.eventSource;
        this.eventTypes = options.eventTypes || {};
        this.documentRef = options.documentRef || globalThis.document;
        this.roles = { ...DEFAULT_ROLE_CONFIG, ...(options.roles || {}) };
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.selectProfile = options.selectProfile || defaultSelectProfile;
        this.selectPreset = options.selectPreset;
        this.waitForConnection = options.waitForConnection || ((args) => waitForOnlineStatus({
            ...args,
            eventSource: this.eventSource || args.context?.eventSource,
            eventTypes: this.eventTypes,
        }));
    }

    getRoleConfig(role) {
        const key = asNonEmptyString(role).toLowerCase();
        if (!ROLE_NAMES.includes(key)) {
            throw new RoleSwitchError(`Unknown ST-FLASH role: ${String(role)}`, { code: 'UNKNOWN_ROLE', role: key });
        }
        const config = this.roles[key] || {};
        const profileId = asNonEmptyString(config.profileId || config.profile || config.connectionProfileId);
        const presetName = asNonEmptyString(config.presetName || config.preset);
        if (!profileId || !presetName) {
            throw new RoleSwitchError(`Role ${key} is not configured with both a profile ID and preset name.`, {
                code: 'ROLE_NOT_CONFIGURED',
                role: key,
            });
        }
        return { role: key, profileId, presetName, expectedModel: asNonEmptyString(config.expectedModel || config.model) };
    }

    setRoles(roles = {}) {
        this.roles = { ...this.roles, ...roles };
        return this.roles;
    }

    getCurrentState() {
        const context = this.getContext?.();
        const manager = context?.extensionSettings?.connectionManager;
        const profile = manager ? getCurrentProfile(context) : null;
        const presetManager = this.getPresetManager?.('openai') || context?.getPresetManager?.('openai');
        return {
            profileId: asNonEmptyString(manager?.selectedProfile),
            profileName: asNonEmptyString(profile?.name),
            presetName: getPresetName(presetManager),
            model: getEffectiveModel(context, profile),
            api: asNonEmptyString(profile?.api || context?.chatCompletionSettings?.chat_completion_source),
        };
    }

    /** True only when both the configured profile and preset are active. */
    isCurrentRole(role) {
        const target = this.getRoleConfig(role);
        const current = this.getCurrentState();
        if (current.profileId !== target.profileId || current.presetName !== target.presetName) return false;
        return !target.expectedModel || !current.model || current.model === target.expectedModel;
    }

    /** Snapshot only reversible identifiers/settings; never include profile secrets. */
    snapshot() {
        return clonePlain(this.getCurrentState());
    }

    async switchTo(role) {
        const target = this.getRoleConfig(role);
        const context = this.getContext?.();
        if (!context) throw new RoleSwitchError('SillyTavern context is unavailable.', { code: 'CONTEXT_UNAVAILABLE', role: target.role });

        const manager = getProfileManagerState(context);
        const profile = findProfile(manager, target.profileId);
        if (!profile) {
            throw new RoleSwitchError(`Connection profile ${target.profileId} is not configured in SillyTavern.`, {
                code: 'PROFILE_NOT_FOUND',
                role: target.role,
            });
        }

        const profileEvent = this.eventTypes.CONNECTION_PROFILE_LOADED;
        const presetEvent = this.eventTypes.OAI_PRESET_CHANGED_AFTER;
        try {
            // Profile first. The listener is registered before dispatch because
            // Connection Manager emits CONNECTION_PROFILE_LOADED asynchronously
            // from its select change handler.
            if (asNonEmptyString(manager.selectedProfile) !== target.profileId) {
                const profileWait = waitForEvent(this.eventSource || context.eventSource, profileEvent, this.timeoutMs, 'connection profile load');
                await this.selectProfile(profile, { context, documentRef: this.documentRef });
                await profileWait;
            }

            // A selected profile can still be disconnected (for example after
            // a provider timeout or page reload). Readiness is therefore
            // checked on every role switch, not only after changing profiles.
            if (this.waitForConnection) await this.waitForConnection({ context, profile, timeoutMs: this.timeoutMs });

            const afterProfile = getCurrentProfile(context);
            if (asNonEmptyString(manager.selectedProfile) !== target.profileId || afterProfile?.id !== target.profileId) {
                throw new RoleSwitchError(`Connection profile validation failed for ${target.role}.`, {
                    code: 'PROFILE_VALIDATION_FAILED',
                    role: target.role,
                });
            }

            const presetManager = this.getPresetManager?.('openai') || context.getPresetManager?.('openai');
            if (!presetManager) throw new RoleSwitchError('OpenAI preset manager is unavailable.', { code: 'PRESET_MANAGER_UNAVAILABLE', role: target.role });
            const presetValue = typeof presetManager.findPreset === 'function' ? presetManager.findPreset(target.presetName) : target.presetName;
            if (presetValue === undefined || presetValue === null || presetValue === '') {
                throw new RoleSwitchError(`OpenAI preset is not available: ${target.presetName}`, { code: 'PRESET_NOT_FOUND', role: target.role });
            }

            const currentPreset = getPresetName(presetManager);
            if (currentPreset !== target.presetName) {
                const presetWait = waitForEvent(this.eventSource || context.eventSource, presetEvent, this.timeoutMs, 'OpenAI preset change');
                if (this.selectPreset) {
                    await this.selectPreset(presetManager, presetValue, { context, role: target.role });
                } else if (typeof presetManager.selectPreset === 'function') {
                    await presetManager.selectPreset(presetValue);
                } else {
                    throw new RoleSwitchError('OpenAI preset manager cannot select presets.', { code: 'PRESET_SELECTOR_UNAVAILABLE', role: target.role });
                }
                await presetWait;
            }

            const afterPreset = getPresetName(presetManager);
            if (afterPreset !== target.presetName) {
                throw new RoleSwitchError(`OpenAI preset validation failed for ${target.role}: expected ${target.presetName}, got ${afterPreset || '(none)'}.`, {
                    code: 'PRESET_VALIDATION_FAILED',
                    role: target.role,
                });
            }

            const effectiveModel = getEffectiveModel(context, afterProfile);
            const expectedModel = target.expectedModel || asNonEmptyString(profile.model);
            const profileModel = asNonEmptyString(afterProfile?.model);
            if (expectedModel && profileModel && expectedModel !== profileModel) {
                throw new RoleSwitchError(`Profile model validation failed for ${target.role}: expected ${expectedModel}, profile declares ${profileModel}.`, {
                    code: 'MODEL_VALIDATION_FAILED',
                    role: target.role,
                });
            }
            if (expectedModel && effectiveModel && expectedModel !== effectiveModel) {
                throw new RoleSwitchError(`Model validation failed for ${target.role}: expected ${expectedModel}, got ${effectiveModel}.`, {
                    code: 'MODEL_VALIDATION_FAILED',
                    role: target.role,
                });
            }

            return {
                role: target.role,
                profileId: target.profileId,
                profileName: profile.name || '',
                presetName: target.presetName,
                model: effectiveModel,
                verified: {
                    profile: true,
                    preset: true,
                    model: Boolean(expectedModel && effectiveModel),
                },
            };
        } catch (error) {
            if (error instanceof RoleSwitchError) throw error;
            throw new RoleSwitchError(`Failed to switch to ${target.role}.`, {
                code: 'ROLE_SWITCH_FAILED',
                role: target.role,
                cause: error,
            });
        }
    }

    async restore(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') {
            throw new RoleSwitchError('No valid role snapshot was provided.', { code: 'INVALID_SNAPSHOT' });
        }
        const context = this.getContext?.();
        if (!context) throw new RoleSwitchError('SillyTavern context is unavailable.', { code: 'CONTEXT_UNAVAILABLE' });
        const manager = getProfileManagerState(context);
        const profileId = asNonEmptyString(snapshot.profileId);
        const profile = findProfile(manager, profileId);
        const profileEvent = this.eventTypes.CONNECTION_PROFILE_LOADED;
        const presetEvent = this.eventTypes.OAI_PRESET_CHANGED_AFTER;

        if (profileId && !profile) {
            throw new RoleSwitchError(`Cannot restore missing connection profile ${profileId}.`, { code: 'SNAPSHOT_PROFILE_NOT_FOUND' });
        }

        try {
            if (asNonEmptyString(manager.selectedProfile) !== profileId) {
                const profileWait = waitForEvent(this.eventSource || context.eventSource, profileEvent, this.timeoutMs, 'connection profile restore');
                await this.selectProfile(profile || { id: '', name: '' }, { context, documentRef: this.documentRef });
                await profileWait;
            }

            if (asNonEmptyString(manager.selectedProfile) !== profileId) {
                throw new RoleSwitchError('Connection profile restore validation failed.', { code: 'RESTORE_PROFILE_VALIDATION_FAILED' });
            }

            const presetManager = this.getPresetManager?.('openai') || context.getPresetManager?.('openai');
            const presetName = asNonEmptyString(snapshot.presetName);
            if (presetName && presetManager) {
                const presetValue = typeof presetManager.findPreset === 'function' ? presetManager.findPreset(presetName) : presetName;
                if (presetValue === undefined || presetValue === null || presetValue === '') {
                    throw new RoleSwitchError(`Cannot restore missing OpenAI preset ${presetName}.`, { code: 'SNAPSHOT_PRESET_NOT_FOUND' });
                }
                if (getPresetName(presetManager) !== presetName) {
                    const presetWait = waitForEvent(this.eventSource || context.eventSource, presetEvent, this.timeoutMs, 'OpenAI preset restore');
                    if (this.selectPreset) await this.selectPreset(presetManager, presetValue, { context, restoring: true });
                    else await presetManager.selectPreset(presetValue);
                    await presetWait;
                }
                if (getPresetName(presetManager) !== presetName) {
                    throw new RoleSwitchError('OpenAI preset restore validation failed.', { code: 'RESTORE_PRESET_VALIDATION_FAILED' });
                }
            }

            return this.getCurrentState();
        } catch (error) {
            if (error instanceof RoleSwitchError) throw error;
            throw new RoleSwitchError('Failed to restore the previous model role.', { code: 'RESTORE_FAILED', cause: error });
        }
    }
}

export function createRoleSwitcher(options = {}) {
    return new RoleSwitcher(options);
}

export default RoleSwitcher;

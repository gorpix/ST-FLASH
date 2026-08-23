/**
 * ST-FLASH third-party extension entry point.
 *
 * This file is intentionally thin.  The phase machine lives in src/controller
 * so it can be tested without importing SillyTavern's browser globals.
 */

import {
    Generate,
    chat,
    eventSource,
    event_types,
    generateQuietPrompt,
    saveMetadata,
    saveChatConditional,
    sendMessageAsUser,
    setExtensionPrompt,
    stopGeneration,
    updateMessageBlock,
    saveSettingsDebounced,
} from '../../../../script.js';
import { extension_settings, getContext, saveMetadataDebounced } from '../../../extensions.js';
import { getPresetManager } from '../../../preset-manager.js';
import { IGNORE_SYMBOL } from '../../../constants.js';
import { power_user } from '../../../power-user.js';

import { MODULE_NAME, mergeSettings } from './src/config.js';
import { createFlashController } from './src/controller.js';
import { detectRoleProfiles } from './src/profile-detection.js';
import { createRoleSwitcher } from './src/role-switcher.js';
import { createSummaryceptionAdapter } from './src/summaryception-adapter.js';

async function initialize() {
    if (globalThis.__ST_FLASH_CONTROLLER__) return globalThis.__ST_FLASH_CONTROLLER__;

    const context = getContext();
    const settings = mergeSettings(extension_settings[MODULE_NAME] || {});
    const availableProfiles = context.extensionSettings?.connectionManager?.profiles || [];
    const detected = detectRoleProfiles(settings.profiles, availableProfiles);
    settings.profiles = detected.profiles;
    extension_settings[MODULE_NAME] = settings;

    if (detected.changed) saveSettingsDebounced();

    if (!globalThis.document?.getElementById?.('st_flash_settings')) {
        const render = context.renderExtensionTemplateAsync;
        const host = globalThis.document?.getElementById?.('extensions_settings2');
        if (typeof render === 'function' && host) {
            const html = await render('third-party/ST-FLASH', 'settings', {});
            host.insertAdjacentHTML('beforeend', html);
        } else {
            console.warn('[ST-FLASH] settings host or template renderer is unavailable.');
        }
    }

    const role = (profileKey, presetKey) => ({
        profileId: settings.profiles?.[profileKey] || '',
        presetName: settings.presets?.[presetKey] || '',
    });

    const roleSwitcher = createRoleSwitcher({
        getContext,
        getPresetManager: () => getPresetManager('openai'),
        eventSource,
        eventTypes: event_types,
        documentRef: globalThis.document,
        roles: {
            anchor: role('anchor', 'anchor'),
            capsule: role('flash', 'capsule'),
            flash: role('flash', 'flash'),
            landing: role('landing', 'landing'),
            continuation: role('landing', 'continuation'),
        },
    });

    const summaryception = createSummaryceptionAdapter({
        getContext,
        saveSettings: saveSettingsDebounced,
        documentRef: globalThis.document,
    });

    const controller = createFlashController({
        getContext,
        eventSource,
        eventTypes: event_types,
        roleSwitcher,
        summaryception,
        generateQuietPrompt,
        generate: Generate,
        sendMessageAsUser,
        setExtensionPrompt,
        updateMessageBlock,
        saveMetadataDebounced,
        saveMetadata,
        saveChat: saveChatConditional,
        stopGeneration,
        powerUser: power_user,
        ignoreSymbol: IGNORE_SYMBOL,
        settings,
        logger: console,
    });

    // UI is intentionally lazy so a malformed optional settings template does
    // not prevent the protocol controller from loading in a headless test.
    try {
        const uiModule = await import('./src/ui.js');
        const createUi = uiModule.createUi || uiModule.default;
        if (typeof createUi === 'function') {
            const ui = createUi(controller.getUiCallbacks());
            controller.setUi(ui);
            if (typeof ui?.bindSettings === 'function') {
                ui.bindSettings({
                    root: globalThis.document,
                    initial: settings,
                    profileOptions: availableProfiles,
                    onChange: (patch) => {
                        const wasEnabled = controller.settings.enabled;
                        const next = controller.updateSettings(patch || {});
                        extension_settings[MODULE_NAME] = next;
                        roleSwitcher.setRoles({
                            anchor: { profileId: next.profiles.anchor, presetName: next.presets.anchor },
                            capsule: { profileId: next.profiles.flash, presetName: next.presets.capsule },
                            flash: { profileId: next.profiles.flash, presetName: next.presets.flash },
                            landing: { profileId: next.profiles.landing, presetName: next.presets.landing },
                            continuation: { profileId: next.profiles.landing, presetName: next.presets.continuation },
                        });
                        saveSettingsDebounced();
                        if (wasEnabled && !next.enabled && controller.readSession().phase !== 'IDLE') void controller.abort();
                    },
                });
            }

            const refreshProfiles = () => {
                const profiles = getContext().extensionSettings?.connectionManager?.profiles || [];
                const latest = detectRoleProfiles(controller.settings.profiles, profiles);
                ui.setProfileOptions?.(profiles, latest.profiles);
                if (!latest.changed) return;
                const next = controller.updateSettings({ profiles: latest.profiles });
                extension_settings[MODULE_NAME] = next;
                roleSwitcher.setRoles({
                    anchor: { profileId: next.profiles.anchor, presetName: next.presets.anchor },
                    capsule: { profileId: next.profiles.flash, presetName: next.presets.capsule },
                    flash: { profileId: next.profiles.flash, presetName: next.presets.flash },
                    landing: { profileId: next.profiles.landing, presetName: next.presets.landing },
                    continuation: { profileId: next.profiles.landing, presetName: next.presets.continuation },
                });
                saveSettingsDebounced();
            };
            if (event_types.APP_READY) eventSource.on(event_types.APP_READY, refreshProfiles);
            if (event_types.CONNECTION_PROFILE_LOADED) eventSource.on(event_types.CONNECTION_PROFILE_LOADED, refreshProfiles);
            refreshProfiles();
        }
    } catch (error) {
        console.warn('[ST-FLASH] UI module unavailable; protocol controls are disabled.', error);
    }

    controller.attach();
    globalThis.__ST_FLASH_CONTROLLER__ = controller;
    console.log('[ST-FLASH] loaded', { version: '0.1.0', chatLength: chat?.length ?? 0 });
    return controller;
}

void initialize().catch((error) => {
    console.error('[ST-FLASH] failed to initialize', error);
});

export { initialize };
export const init = initialize;
export default initialize;

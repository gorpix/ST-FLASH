/**
 * Small, defensive adapter for Summaryception v5.5.3.
 *
 * Summaryception intentionally has no public pause API. Its documented
 * settings live at extensionSettings.summaryception. ST-FLASH disables the
 * extension during accepted Flash/Landing (and sets pauseSummarization as a
 * belt-and-suspenders guard), then restores both values exactly when the
 * composite turn ends.
 */

export const SUMMARYCEPTION_NAMESPACE = 'summaryception';

const DEFAULT_SELECTORS = Object.freeze({
    enabled: '#sc_enabled',
    pauseSummarization: '#sc_pause_summarization',
});

export class SummaryceptionAdapterError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'SummaryceptionAdapterError';
        this.code = details.code || 'SUMMARYCEPTION_ADAPTER_FAILED';
        this.cause = details.cause;
    }
}

function own(object, key) {
    return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
}

function boolOrUndefined(value) {
    return typeof value === 'boolean' ? value : undefined;
}

/**
 * @typedef {object} SummaryceptionSnapshot
 * @property {boolean} available Whether Summaryception was present when taken.
 * @property {boolean|undefined} enabled Original enabled setting.
 * @property {boolean|undefined} pauseSummarization Original pause setting.
 */

export class SummaryceptionAdapter {
    constructor(options = {}) {
        this.getContext = options.getContext || (() => globalThis.SillyTavern?.getContext?.());
        this.documentRef = options.documentRef || globalThis.document;
        this.saveSettings = options.saveSettings || (() => this.getContext?.()?.saveSettingsDebounced?.());
        this.selectors = { ...DEFAULT_SELECTORS, ...(options.selectors || {}) };
        this.namespace = options.namespace || SUMMARYCEPTION_NAMESPACE;
    }

    getSettings() {
        const context = this.getContext?.();
        const extensionSettings = context?.extensionSettings;
        const settings = extensionSettings?.[this.namespace];
        return settings && typeof settings === 'object' ? settings : null;
    }

    isAvailable() {
        return Boolean(this.getSettings());
    }

    snapshot() {
        const settings = this.getSettings();
        if (!settings) return { available: false };
        return {
            available: true,
            enabled: boolOrUndefined(settings.enabled),
            pauseSummarization: boolOrUndefined(settings.pauseSummarization),
        };
    }

    updateUi(settings) {
        try {
            const documentRef = this.documentRef;
            if (!documentRef?.querySelector) return;
            const enabled = documentRef.querySelector(this.selectors.enabled);
            const paused = documentRef.querySelector(this.selectors.pauseSummarization);
            if (enabled && typeof settings.enabled === 'boolean') enabled.checked = settings.enabled;
            if (paused && typeof settings.pauseSummarization === 'boolean') paused.checked = settings.pauseSummarization;
        } catch (error) {
            // UI is optional. A missing/changed Summaryception settings panel
            // must never prevent the protocol from restoring its settings.
            console.debug('[ST-FLASH] Could not refresh Summaryception UI:', error);
        }
    }

    async persist() {
        try {
            const result = this.saveSettings?.();
            if (result && typeof result.then === 'function') await result;
        } catch (error) {
            throw new SummaryceptionAdapterError('Could not persist Summaryception settings.', {
                code: 'SETTINGS_SAVE_FAILED',
                cause: error,
            });
        }
    }

    async patch(patch = {}, { persist = true, refreshUi = true } = {}) {
        const settings = this.getSettings();
        if (!settings) {
            return { available: false, changed: false };
        }

        let changed = false;
        for (const key of ['enabled', 'pauseSummarization']) {
            if (!own(patch, key) || typeof patch[key] !== 'boolean') continue;
            if (settings[key] !== patch[key]) {
                settings[key] = patch[key];
                changed = true;
            }
        }

        if (refreshUi) this.updateUi(settings);
        if (persist && changed) await this.persist();

        return {
            available: true,
            changed,
            enabled: boolOrUndefined(settings.enabled),
            pauseSummarization: boolOrUndefined(settings.pauseSummarization),
        };
    }

    /** Pause new Summaryception processing while keeping existing injection. */
    async pauseForFlash(options = {}) {
        return this.patch({ pauseSummarization: true }, options);
    }

    /** Alias used by controllers that call the phase simply “pause”. */
    async pause(options = {}) {
        return this.pauseForFlash(options);
    }

    /**
     * Disable Summaryception during accepted Flash/Landing. Existing settings
     * are not discarded; the controller restores the snapshot afterward.
     */
    async disableForFlash(options = {}) {
        return this.patch({ enabled: false, pauseSummarization: true }, options);
    }

    /** Resume processing without changing whether Summaryception is enabled. */
    async resume(options = {}) {
        return this.patch({ pauseSummarization: false }, options);
    }

    /** Restore the exact values captured at session start. */
    async restore(snapshot, options = {}) {
        if (!snapshot || snapshot.available !== true) {
            return { available: false, changed: false };
        }

        const patch = {};
        if (typeof snapshot.enabled === 'boolean') patch.enabled = snapshot.enabled;
        if (typeof snapshot.pauseSummarization === 'boolean') patch.pauseSummarization = snapshot.pauseSummarization;
        return this.patch(patch, options);
    }
}

export function createSummaryceptionAdapter(options = {}) {
    return new SummaryceptionAdapter(options);
}

export default SummaryceptionAdapter;

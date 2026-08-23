import assert from 'node:assert/strict';
import test from 'node:test';
import { RoleSwitcher, RoleSwitchError } from '../src/role-switcher.js';

class MockEvents {
    constructor() {
        this.listeners = new Map();
    }

    on(name, listener) {
        const list = this.listeners.get(name) || [];
        list.push(listener);
        this.listeners.set(name, list);
    }

    removeListener(name, listener) {
        const list = this.listeners.get(name) || [];
        this.listeners.set(name, list.filter((candidate) => candidate !== listener));
    }

    emit(name, ...args) {
        for (const listener of [...(this.listeners.get(name) || [])]) listener(...args);
    }
}

function makeHarness({ modelMismatch = false } = {}) {
    const events = new MockEvents();
    const manager = {
        selectedProfile: 'profile-a',
        profiles: [
            { id: 'profile-a', name: 'A', model: modelMismatch ? 'wrong-model' : 'model-a' },
            { id: 'profile-b', name: 'B', model: 'model-b' },
        ],
    };
    const context = {
        extensionSettings: { connectionManager: manager },
        chatCompletionSettings: { custom_model: 'model-a', chat_completion_source: 'custom' },
    };
    let selectedPreset = 'Anchor';
    const presetManager = {
        findPreset: (name) => name,
        getSelectedPresetName: () => selectedPreset,
        selectPreset: (value) => {
            selectedPreset = value;
            events.emit('oai_after');
        },
    };
    const switcher = new RoleSwitcher({
        getContext: () => context,
        getPresetManager: () => presetManager,
        eventSource: events,
        eventTypes: { CONNECTION_PROFILE_LOADED: 'profile_loaded', OAI_PRESET_CHANGED_AFTER: 'oai_after' },
        timeoutMs: 100,
        roles: {
            anchor: { profileId: 'profile-a', presetName: 'Anchor', expectedModel: 'model-a' },
            flash: { profileId: 'profile-b', presetName: 'Flash', expectedModel: 'model-b' },
        },
        selectProfile: (profile) => {
            manager.selectedProfile = profile.id;
            context.chatCompletionSettings.custom_model = profile.model;
            events.emit('profile_loaded', profile.name);
        },
    });
    return { switcher, context, manager, events, presetManager };
}

test('switches profile before preset and validates the effective model', async () => {
    const harness = makeHarness();
    const result = await harness.switcher.switchTo('flash');

    assert.equal(result.role, 'flash');
    assert.equal(result.profileId, 'profile-b');
    assert.equal(result.presetName, 'Flash');
    assert.equal(result.model, 'model-b');
    assert.equal(result.verified.model, true);
    assert.equal(harness.manager.selectedProfile, 'profile-b');
});

test('takes a non-secret snapshot and restores the prior role', async () => {
    const harness = makeHarness();
    const snapshot = harness.switcher.snapshot();
    assert.deepEqual(snapshot, {
        profileId: 'profile-a',
        profileName: 'A',
        presetName: 'Anchor',
        model: 'model-a',
        api: 'custom',
    });

    await harness.switcher.switchTo('flash');
    await harness.switcher.restore(snapshot);
    assert.equal(harness.manager.selectedProfile, 'profile-a');
    assert.equal(harness.presetManager.getSelectedPresetName(), 'Anchor');
    assert.equal(harness.context.chatCompletionSettings.custom_model, 'model-a');
});

test('rejects a model mismatch instead of silently generating with the wrong model', async () => {
    const harness = makeHarness({ modelMismatch: true });
    await assert.rejects(
        () => harness.switcher.switchTo('anchor'),
        (error) => error instanceof RoleSwitchError && error.code === 'MODEL_VALIDATION_FAILED',
    );
});

test('rejects an unconfigured role before touching SillyTavern', async () => {
    const harness = makeHarness();
    await assert.rejects(
        () => harness.switcher.switchTo('landing'),
        (error) => error instanceof RoleSwitchError && error.code === 'ROLE_NOT_CONFIGURED',
    );
});

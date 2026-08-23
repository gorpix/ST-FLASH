import assert from 'node:assert/strict';
import test from 'node:test';
import { SummaryceptionAdapter } from '../src/summaryception-adapter.js';

test('degrades to a no-op when Summaryception is not installed', async () => {
    const context = { extensionSettings: {} };
    const adapter = new SummaryceptionAdapter({ getContext: () => context });

    assert.equal(adapter.isAvailable(), false);
    assert.deepEqual(adapter.snapshot(), { available: false });
    assert.deepEqual(await adapter.pauseForFlash(), { available: false, changed: false });
    assert.deepEqual(await adapter.restore({ available: false }), { available: false, changed: false });
});

test('pauses processing without disabling existing summary injection', async () => {
    const context = { extensionSettings: { summaryception: { enabled: true, pauseSummarization: false } } };
    const checked = {};
    const documentRef = {
        querySelector(selector) {
            const key = selector.slice(1);
            return checked[key] ||= { checked: false };
        },
    };
    let saves = 0;
    const adapter = new SummaryceptionAdapter({ getContext: () => context, documentRef, saveSettings: () => { saves++; } });

    const snapshot = adapter.snapshot();
    const result = await adapter.pauseForFlash();
    assert.deepEqual(snapshot, { available: true, enabled: true, pauseSummarization: false });
    assert.equal(result.changed, true);
    assert.equal(context.extensionSettings.summaryception.enabled, true);
    assert.equal(context.extensionSettings.summaryception.pauseSummarization, true);
    assert.equal(checked.sc_pause_summarization.checked, true);
    assert.equal(saves, 1);
});

test('disables Summaryception during Flash and keeps the pause guard set', async () => {
    const context = { extensionSettings: { summaryception: { enabled: true, pauseSummarization: false } } };
    let saves = 0;
    const adapter = new SummaryceptionAdapter({ getContext: () => context, saveSettings: () => { saves++; } });

    const result = await adapter.disableForFlash();
    assert.equal(result.changed, true);
    assert.deepEqual(context.extensionSettings.summaryception, { enabled: false, pauseSummarization: true });
    assert.equal(saves, 1);
});

test('restores both Summaryception flags exactly', async () => {
    const context = { extensionSettings: { summaryception: { enabled: false, pauseSummarization: true } } };
    let saves = 0;
    const adapter = new SummaryceptionAdapter({ getContext: () => context, saveSettings: () => { saves++; } });

    await adapter.patch({ enabled: true, pauseSummarization: false });
    const restored = await adapter.restore({ available: true, enabled: false, pauseSummarization: true });
    assert.equal(restored.changed, true);
    assert.deepEqual(context.extensionSettings.summaryception, { enabled: false, pauseSummarization: true });
    assert.equal(saves, 2);
});

test('does not persist when a pause request is already satisfied', async () => {
    const context = { extensionSettings: { summaryception: { enabled: true, pauseSummarization: true } } };
    let saves = 0;
    const adapter = new SummaryceptionAdapter({ getContext: () => context, saveSettings: () => { saves++; } });
    const result = await adapter.pauseForFlash();

    assert.equal(result.changed, false);
    assert.equal(saves, 0);
});

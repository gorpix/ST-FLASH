import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { INJECTION_KEYS } from '../src/config.js';
import { createFlashController } from '../src/controller.js';
import { PHASES, readSession } from '../src/session-store.js';

const IGNORE = Symbol('st-flash-test-ignore');
const EVENT_TYPES = Object.freeze({
    MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
    CHAT_CHANGED: 'CHAT_CHANGED',
    APP_READY: 'APP_READY',
    GENERATION_STARTED: 'GENERATION_STARTED',
    GENERATION_ENDED: 'GENERATION_ENDED',
    GENERATION_STOPPED: 'GENERATION_STOPPED',
    MESSAGE_SWIPED: 'MESSAGE_SWIPED',
});

const CAPSULE = `<flash_capsule>
ENTRY: AUTO
LOCAL FRAME:
The two characters are in the established room and the Anchor opening is the first Flash beat.
RECENT CONTEXT:
The preceding exchange is already represented by the Anchor opening and the ordinary chat history.
AUTHORIZED LOCAL ACTORS:
Rex may respond; the user controls Janko. Keep the exchange local and immediately reactive.
</flash_capsule>`;
const USER_CAPSULE = CAPSULE.replace('ENTRY: AUTO', 'ENTRY: USER');

const FLASH_OUTPUT = `Rex gives a short, immediate answer and leaves room for Janko to reply.

<flash_delta>
TIME: ~4 seconds
POSITION: Rex turns toward Janko
CONDITION: None
KNOWLEDGE: Rex hears Janko's claim — CLAIM
POSSESSION: None
PROPOSAL: None
COMMITMENT: None
OTHER: None
</flash_delta>`;

const LANDING_OUTPUT = `Rex's answer settles the exchange into the next beat of the scene.

<internal_states>
TIME: 11:00 AM
POSITION: Rex faces Janko in the room.
CONDITION: None.
KNOWLEDGE: The exchange occurred.
POSSESSION: None.
COMMITMENT: Existing plans remain.
</internal_states>`;

const CONTINUATION_OUTPUT = `Rex answers the newly supplied user direction as an ordinary roleplay response.

<internal_states>
TIME: 11:00 AM
POSITION: Rex remains in place.
CONDITION: None.
KNOWLEDGE: Rex heard the user's direction.
POSSESSION: None.
COMMITMENT: None.
</internal_states>`;

const CONTINUATION_APPEND = ` Rex adds one more immediate beat before the message ends.

<internal_states>
TIME: 11:00 AM
POSITION: Rex remains in place.
CONDITION: None.
KNOWLEDGE: None.
POSSESSION: None.
COMMITMENT: None.
</internal_states>`;

function tick() {
    return new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function message(id, isUser, mes, extra = {}) {
    return { id, is_user: isUser, is_system: false, mes, extra };
}

function makeHarness({
    entry = 'AUTO',
    capsule = CAPSULE,
    flashOutput = FLASH_OUTPUT,
    landingOutput = LANDING_OUTPUT,
    continuationOutput = CONTINUATION_OUTPUT,
    continuationAppend = CONTINUATION_APPEND,
    continuationOutputs = null,
    failAfterFirstUserInsert = false,
    emitGeneratedMessage = false,
} = {}) {
    const chat = [
        message('u-before', true, 'Earlier user context.'),
        message('a-before', false, 'Earlier assistant context.\n<internal_states>old</internal_states>'),
        message('u-anchor', true, 'The user asks for the next scene beat.'),
        message('a-anchor', false, `Rex opens on a useful conversational beat.\n<flash_handoff entry="${entry}"/>`),
    ];
    const metadata = {};
    const eventSource = new EventEmitter();
    const calls = {
        generate: [],
        quiet: [],
        sendUser: [],
        role: [],
        summary: [],
        ui: [],
        savedMetadata: 0,
        savedChat: 0,
        injections: new Map(),
    };
    let composer = '';
    let role = 'anchor';
    let userSequence = 0;
    let failUserInsert = Boolean(failAfterFirstUserInsert);
    let continuationCall = 0;
    let currentChatKey = 'test-chat';

    const roleSwitcher = {
        isCurrentRole(name) {
            return role === name;
        },
        snapshot() {
            return { role, profileId: `profile-${role}`, presetName: `preset-${role}` };
        },
        async switchTo(name) {
            role = name;
            calls.role.push(`switch:${name}`);
        },
        async restore(snapshot) {
            role = snapshot?.role || 'anchor';
            calls.role.push(`restore:${role}`);
        },
    };

    const summaryception = {
        snapshot: () => ({ available: true, enabled: true, pauseSummarization: false }),
        async disableForFlash() {
            calls.summary.push('disable');
            return { changed: true };
        },
        async restore(snapshot) {
            calls.summary.push(['restore', snapshot]);
            return { changed: true };
        },
    };

    const ui = {
        showOffer(payload) { calls.ui.push(['offer', payload]); },
        hideOffer() { calls.ui.push(['hide-offer']); },
        showFlashStatus(payload) { calls.ui.push(['flash-status', payload]); },
        showRecovery(payload) { calls.ui.push(['recovery', payload]); },
        setInteractionMode(payload) { calls.ui.push(['mode', payload]); },
        clearRuntime() { calls.ui.push(['clear']); },
        readComposer() { return composer; },
        setComposer(value) { composer = String(value ?? ''); calls.ui.push(['composer', composer]); },
    };

    const context = {
        chat,
        chatMetadata: metadata,
        eventSource,
        eventTypes: EVENT_TYPES,
        getCurrentChatId: () => currentChatKey,
    };

    const powerUser = { auto_swipe: true, auto_continue: { enabled: true } };

    async function generate(type, options) {
        calls.generate.push({ type, options, role });
        if (type === 'continue') {
            const target = chat[chat.length - 1];
            target.mes += continuationAppend;
            return target;
        }
        eventSource.emit(EVENT_TYPES.GENERATION_STARTED, 'normal', options);
        await tick();
        const output = role === 'flash'
            ? flashOutput
            : role === 'landing'
                ? landingOutput
                : Array.isArray(continuationOutputs)
                    ? continuationOutputs[Math.min(continuationCall++, continuationOutputs.length - 1)]
                    : continuationOutput;
        chat.push(message(`assistant-${chat.length}`, false, output));
        if (emitGeneratedMessage) {
            await controller.handleMessageReceived(chat.length - 1, 'normal');
        }
        eventSource.emit(EVENT_TYPES.GENERATION_ENDED, 'normal', options);
        await tick();
        return chat[chat.length - 1];
    }

    async function sendMessageAsUser(value) {
        calls.sendUser.push(value);
        const result = message(`user-inserted-${++userSequence}`, true, value);
        chat.push(result);
        if (failUserInsert) {
            failUserInsert = false;
            throw new Error('Simulated boundary failure after user insertion.');
        }
        return result;
    }

    const controller = createFlashController({
        getContext: () => context,
        eventSource,
        eventTypes: EVENT_TYPES,
        roleSwitcher,
        summaryception,
        ui,
        generateQuietPrompt: async (options) => {
            calls.quiet.push(options);
            return capsule;
        },
        generate,
        sendMessageAsUser,
        setExtensionPrompt: (key, value) => calls.injections.set(key, value),
        updateMessageBlock: () => {},
        saveMetadataDebounced: () => { calls.savedMetadata += 1; },
        saveMetadata: () => { calls.savedMetadata += 1; },
        saveChat: () => { calls.savedChat += 1; },
        ignoreSymbol: IGNORE,
        powerUser,
        settings: { enabled: true, landingBaselineMessages: 5 },
        logger: { warn() {}, error() {} },
    });
    controller.attach();

    return {
        controller,
        context,
        chat,
        metadata,
        roleSwitcher,
        summaryception,
        ui,
        calls,
        powerUser,
        get role() { return role; },
        set role(value) { role = value; },
        set composer(value) { composer = value; },
        switchChat(nextChat, nextMetadata = {}, nextKey = 'next-chat') {
            context.chat = nextChat;
            context.chatMetadata = nextMetadata;
            currentChatKey = nextKey;
        },
    };
}

async function offer(harness) {
    await harness.controller.handleMessageReceived(3, 'normal');
    assert.equal(readSession(harness.metadata).phase, PHASES.OFFERED);
    return harness;
}

async function acceptIntoFlash(harness, userText = null) {
    await offer(harness);
    await harness.controller.acceptFlash(userText);
    assert.equal(readSession(harness.metadata).phase, PHASES.FLASH);
    return harness;
}

async function processFlashOutput(harness, output = FLASH_OUTPUT) {
    // A manual turn is normally preceded by GENERATION_STARTED. The helper
    // deliberately calls the same public handler so ownership checks run.
    await harness.controller.handleGenerationStarted('normal');
    const generated = message(`assistant-${harness.chat.length}`, false, output);
    harness.chat.push(generated);
    await harness.controller.handleMessageReceived(harness.chat.length - 1, 'normal');
    return generated;
}

test('Anchor handoff enters OFFERED only when the configured Anchor role is active', async () => {
    const nonAnchor = makeHarness();
    nonAnchor.role = 'landing';
    await nonAnchor.controller.handleMessageReceived(3, 'normal');
    assert.equal(readSession(nonAnchor.metadata).phase, PHASES.IDLE);
    assert.match(nonAnchor.chat[3].mes, /<flash_handoff/);

    const anchor = makeHarness();
    await offer(anchor);
    assert.equal(anchor.chat[3].mes.includes('<flash_handoff'), false);
    assert.equal(anchor.calls.ui.filter(([kind]) => kind === 'offer').length, 1);
});

test('AUTO accept validates the capsule, enters Flash, and inserts initial user text exactly once', async () => {
    const harness = makeHarness();
    await acceptIntoFlash(harness, '  I answer immediately.  ');

    const session = readSession(harness.metadata);
    assert.equal(session.entry, 'AUTO');
    assert.equal(session.initialUserMessageId, 'user-inserted-1');
    assert.deepEqual(harness.calls.sendUser, ['  I answer immediately.  ']);
    assert.equal(harness.chat.filter((item) => item.is_user && item.mes === '  I answer immediately.  ').length, 1);
    assert.equal(harness.powerUser.auto_swipe, false);
    assert.equal(harness.powerUser.auto_continue.enabled, false);
    assert.match(harness.calls.injections.get(INJECTION_KEYS.CAPSULE), /ENTRY: AUTO/);
    assert.equal(harness.calls.quiet.at(-1).removeReasoning, false);
    assert.equal(harness.calls.quiet.at(-1).responseLength, 3200);
});

test('Capsule intake ignores surrounding reasoning and accepts Markdown-decorated headings', async () => {
    const decorated = `I will now provide the requested capsule.\n\n\`\`\`text\n<FLASH_CAPSULE>\nENTRY: auto\n\n**LOCAL FRAME:**\n- CENTER: dorm desk\n\n## RECENT CONTEXT\nRex opened the exchange.\n\n**AUTHORIZED LOCAL ACTORS:**\nRex is present and authorized. This body is deliberately long enough to remain useful to Flash.\n</FLASH_CAPSULE>\n\`\`\``;
    const harness = makeHarness({ capsule: decorated });
    await acceptIntoFlash(harness);
    const session = readSession(harness.metadata);
    assert.equal(session.phase, PHASES.FLASH);
    assert.match(session.capsule, /LOCAL FRAME/u);
    assert.doesNotMatch(session.capsule, /requested capsule/u);
});

test('Capsule intake recovers a complete structured body when only its wrapper is missing', async () => {
    const wrapperless = `The wrapper was accidentally omitted.\n\nENTRY: AUTO\n\nLOCAL FRAME:\n- CENTER: dorm desk\n\nRECENT CONTEXT:\nRex opened the exchange and is waiting for the immediate reply.\n\nAUTHORIZED LOCAL ACTORS:\nRex is present and authorized. The remaining local details are concrete enough for several short turns.\n\`\`\``;
    const harness = makeHarness({ capsule: wrapperless });
    await acceptIntoFlash(harness);
    const session = readSession(harness.metadata);
    assert.equal(session.phase, PHASES.FLASH);
    assert.match(session.capsule, /^ENTRY: AUTO/u);
    assert.doesNotMatch(session.capsule, /wrapper was accidentally omitted/u);
});

test('valid Flash output strips the delta, stores it with a stable ID, and records its turn', async () => {
    const harness = await acceptIntoFlash(makeHarness(), 'Seed the first Flash turn.');
    // The pending-user path already produced a generated assistant; process
    // that response as the first Flash turn.
    const generated = harness.chat[harness.chat.length - 1];
    await harness.controller.handleMessageReceived(harness.chat.length - 1, 'normal');
    const session = readSession(harness.metadata);
    assert.equal(session.flashTurn, 1);
    assert.equal(session.flashMessageIds.length, 1);
    assert.equal(session.flashMessageIds[0], generated.id);
    assert.equal(session.deltas[0].turn, 1);
    assert.match(session.deltas[0].body, /TIME: ~4 seconds/);
    assert.doesNotMatch(generated.mes, /<flash_delta/);
    const stableId = generated.id;
    await harness.controller.handleMessageReceived(harness.chat.length - 1, 'normal');
    assert.equal(readSession(harness.metadata).flashTurn, 1);
    assert.equal(generated.id, stableId);
});

test('Flash escalation waits for GENERATION_ENDED before starting Landing', async () => {
    const escalation = `<flash_delta>\nTIME: N/A\nPOSITION: N/A\nCONDITION: N/A\nKNOWLEDGE: N/A\nPROPOSAL: N/A\nPOSSESSION: N/A\nCOMMITMENT: N/A\nOTHER: N/A\n</flash_delta>\n<flash_escalate reason="outside Flash authority"/>`;
    const harness = await acceptIntoFlash(makeHarness());
    await processFlashOutput(harness, escalation);

    assert.equal(readSession(harness.metadata).phase, PHASES.FLASH);
    assert.equal(harness.calls.generate.filter((call) => call.role === 'landing').length, 0);

    harness.controller.handleGenerationFinished('ended');
    for (let attempt = 0; attempt < 20 && readSession(harness.metadata).phase !== PHASES.IDLE; attempt += 1) {
        await tick();
    }

    assert.equal(harness.calls.generate.filter((call) => call.role === 'landing').length, 1);
    assert.equal(readSession(harness.metadata).phase, PHASES.IDLE);
    assert.match(harness.chat.at(-1).mes, /<internal_states>/u);
});

test('missing Flash delta keeps usable prose and synthesizes a Landing reconciliation marker', async () => {
    const harness = await acceptIntoFlash(makeHarness({
        flashOutput: 'Rex replies, but forgets the required ledger.',
    }), 'Seed the malformed Flash turn.');
    const generated = harness.chat[harness.chat.length - 1];
    await harness.controller.handleMessageReceived(harness.chat.length - 1, 'normal');
    const session = readSession(harness.metadata);
    assert.equal(session.phase, PHASES.FLASH);
    assert.equal(generated.extra.st_flash.deltaFallback, true);
    assert.equal(generated.extra.st_flash.delta.synthetic, true);
    assert.match(generated.extra.st_flash.delta.body, /reconcile this turn from the visible transcript/u);
    assert.equal(generated.extra[IGNORE], undefined);
    assert.equal(session.flashTurn, 1);
});

test('duplicate Flash deltas remain fatal instead of choosing one silently', async () => {
    const duplicate = `Visible reply.\n<flash_delta>TIME: N/A</flash_delta>\n<flash_delta>TIME: N/A</flash_delta>`;
    const harness = await acceptIntoFlash(makeHarness(), 'Seed the malformed Flash turn.');
    const generated = await processFlashOutput(harness, duplicate);
    const session = readSession(harness.metadata);
    assert.equal(session.phase, PHASES.RECOVERY);
    assert.equal(session.error.operation, 'flash-reply');
    assert.equal(generated.extra.st_flash.failed, true);
    assert.equal(generated.extra[IGNORE], true);
    assert.equal(session.flashTurn, 0);
});

test('Retry salvages a previously failed missing-delta response without another model call', async () => {
    const harness = await acceptIntoFlash(makeHarness());
    const generated = message(`assistant-${harness.chat.length}`, false, 'A usable reply whose ledger was omitted.');
    harness.chat.push(generated);
    harness.controller.markFailedMessage(generated, harness.chat.length - 1, 'flash-reply', [{ code: 'FLASH_DELTA_MISSING' }]);
    await harness.controller.enterRecovery(new Error('Old missing-delta failure'), 'flash-reply');
    const callsBefore = harness.calls.generate.length;

    await harness.controller.retryRecovery();

    const session = readSession(harness.metadata);
    assert.equal(session.phase, PHASES.FLASH);
    assert.equal(session.flashTurn, 1);
    assert.equal(harness.calls.generate.length, callsBefore);
    assert.equal(generated.extra.st_flash.failed, undefined);
    assert.equal(generated.extra.st_flash.deltaFallback, true);
    assert.equal(generated.extra[IGNORE], undefined);
});

test('Landing creates final prose and states, archives the entire handoff-through-Flash range, and restores runtime state', async () => {
    const harness = await acceptIntoFlash(makeHarness(), 'My first Flash reply.');
    await harness.controller.handleMessageReceived(harness.chat.length - 1, 'normal');
    const flashMessage = harness.chat[harness.chat.length - 1];
    const sessionBefore = readSession(harness.metadata);
    const handoffIndex = harness.chat.findIndex((item) => item.id === 'a-anchor');
    const userIndex = harness.chat.findIndex((item) => item.id === 'user-inserted-1');
    assert.equal(sessionBefore.phase, PHASES.FLASH);
    assert.ok(userIndex > handoffIndex);
    assert.ok(flashMessage.extra.st_flash.archived !== true);

    await harness.controller.land();
    const sessionAfter = readSession(harness.metadata);
    assert.equal(sessionAfter.phase, PHASES.IDLE);
    assert.equal(harness.role, 'anchor');
    assert.equal(harness.powerUser.auto_swipe, true);
    assert.equal(harness.powerUser.auto_continue.enabled, true);
    assert.ok(harness.calls.summary.some((entry) => entry[0] === 'restore'));

    const landing = harness.chat[harness.chat.length - 1];
    assert.match(landing.mes, /<internal_states>/);
    assert.equal(landing.is_system, false);
    for (const item of harness.chat.slice(handoffIndex, harness.chat.length - 1)) {
        assert.equal(item.is_system, true, `message ${item.id} was not archived`);
        assert.equal(item.extra.st_flash.archived, true, `message ${item.id} lacked archive metadata`);
        assert.equal(item.extra[IGNORE], true, `message ${item.id} was not persistently ignored`);
    }
    assert.ok(sessionAfter.archivedMessageIds.includes('a-anchor'));
    assert.ok(sessionAfter.archivedMessageIds.includes('user-inserted-1'));
    assert.ok(sessionAfter.archivedMessageIds.includes(flashMessage.id));
});

test('blank decline uses continuation append, while decline text inserts once and creates a new assistant', async () => {
    const blank = await offer(makeHarness());
    const originalLength = blank.chat.length;
    await blank.controller.decline();
    assert.equal(readSession(blank.metadata).phase, PHASES.IDLE);
    assert.equal(blank.chat.length, originalLength);
    assert.equal(blank.calls.generate.at(-1).type, 'continue');
    assert.match(blank.chat[3].mes, /Rex adds one more immediate beat/);
    assert.match(blank.chat[3].mes, /<internal_states>/);

    const withText = await offer(makeHarness());
    await withText.controller.decline('Please keep the scene ordinary.');
    assert.equal(readSession(withText.metadata).phase, PHASES.IDLE);
    assert.deepEqual(withText.calls.sendUser, ['Please keep the scene ordinary.']);
    assert.equal(withText.chat.filter((item) => item.is_user && item.mes === 'Please keep the scene ordinary.').length, 1);
    assert.equal(withText.calls.generate.at(-1).type, 'normal');
    assert.ok(withText.chat.length > 4);
    assert.match(withText.chat.at(-1).mes, /<internal_states>/);
});

test('reload during active Flash reinstates capsule, accumulated deltas, control, and Flash role', async () => {
    const harness = await acceptIntoFlash(makeHarness(), 'Start the exchange.');
    await harness.controller.handleMessageReceived(harness.chat.length - 1, 'normal');
    const before = readSession(harness.metadata);
    assert.equal(before.phase, PHASES.FLASH);
    harness.calls.injections.clear();
    harness.role = 'anchor';
    harness.powerUser.auto_swipe = true;
    harness.powerUser.auto_continue.enabled = true;

    const restored = await harness.controller.handleChatChanged();
    assert.equal(restored.phase, PHASES.FLASH);
    assert.equal(harness.role, 'flash');
    assert.match(harness.calls.injections.get(INJECTION_KEYS.CAPSULE), /<flash_capsule>/);
    assert.match(harness.calls.injections.get(INJECTION_KEYS.DELTAS), /F1:/);
    assert.match(harness.calls.injections.get(INJECTION_KEYS.CONTROL), /FLASH MODE IS ACTIVE/);
    assert.equal(harness.powerUser.auto_swipe, false);
    assert.equal(harness.powerUser.auto_continue.enabled, false);
});

test('USER handoff validates USER capsule entry and insertion retry deduplicates a post-insert failure', async () => {
    const harness = await offer(makeHarness({
        entry: 'USER',
        capsule: USER_CAPSULE,
        failAfterFirstUserInsert: true,
        emitGeneratedMessage: true,
    }));
    await harness.controller.acceptFlash('The user supplied opening.');
    let session = readSession(harness.metadata);
    assert.equal(session.entry, 'USER');
    assert.equal(session.phase, PHASES.RECOVERY);
    assert.equal(session.error.operation, 'flash-entry');
    assert.equal(session.pendingUserText, 'The user supplied opening.');
    assert.equal(harness.calls.sendUser.length, 1);
    assert.equal(harness.chat.filter((item) => item.is_user && item.mes === 'The user supplied opening.').length, 1);

    await harness.controller.retryRecovery();
    session = readSession(harness.metadata);
    assert.equal(session.phase, PHASES.FLASH);
    assert.equal(session.entry, 'USER');
    assert.equal(session.pendingUserText, null);
    assert.equal(harness.calls.sendUser.length, 1, 'retry must reuse the inserted user message');
    assert.equal(harness.chat.filter((item) => item.is_user && item.mes === 'The user supplied opening.').length, 1);
    assert.equal(session.initialUserMessageId, 'user-inserted-1');
});

test('a chat switch during delayed Capsule generation leaves the new chat untouched', async () => {
    const harness = await offer(makeHarness({ entry: 'USER', capsule: USER_CAPSULE }));
    const gate = deferred();
    harness.controller.generateQuietPrompt = () => gate.promise;
    const acceptPromise = harness.controller.acceptFlash('Old chat input.');
    await tick();
    assert.equal(readSession(harness.metadata).phase, PHASES.CAPSULING);

    const nextChat = [message('next-user', true, 'New chat user.'), message('next-assistant', false, 'New chat response.')];
    const nextMetadata = {};
    harness.switchChat(nextChat, nextMetadata);
    await harness.controller.handleChatChanged();
    gate.resolve(USER_CAPSULE);
    await acceptPromise;

    assert.equal(readSession(nextMetadata).phase, PHASES.IDLE);
    assert.deepEqual(nextChat.map((item) => item.mes), ['New chat user.', 'New chat response.']);
    assert.equal(nextChat.some((item) => item.extra?.st_flash), false);
});

test('a chat switch during delayed Landing generation leaves the new chat untouched', async () => {
    const harness = await acceptIntoFlash(makeHarness(), 'Old Flash input.');
    await harness.controller.handleMessageReceived(harness.chat.length - 1, 'normal');
    const gate = deferred();
    const originalGenerate = harness.controller.generate;
    harness.controller.generate = async (...args) => {
        await gate.promise;
        return originalGenerate(...args);
    };
    const landPromise = harness.controller.land();
    await tick();
    assert.equal(readSession(harness.metadata).phase, PHASES.LANDING);

    const nextChat = [message('next-user', true, 'Another chat user.'), message('next-assistant', false, 'Another chat response.')];
    const nextMetadata = {};
    harness.switchChat(nextChat, nextMetadata);
    await harness.controller.handleChatChanged();
    gate.resolve();
    await landPromise;

    assert.equal(readSession(nextMetadata).phase, PHASES.IDLE);
    assert.deepEqual(nextChat.map((item) => item.mes), ['Another chat user.', 'Another chat response.']);
    assert.equal(nextChat.some((item) => item.extra?.st_flash), false);
});

test('malformed Continuation output enters recovery and retry does not duplicate the user prompt', async () => {
    const harness = await offer(makeHarness({ continuationOutputs: [
        'Rex emits a malformed continuation without Internal States.',
        CONTINUATION_OUTPUT,
    ] }));
    await harness.controller.decline('Please continue normally.');
    let session = readSession(harness.metadata);
    assert.equal(session.phase, PHASES.RECOVERY);
    assert.equal(session.error.operation, 'continuation-user');
    assert.equal(harness.calls.sendUser.length, 1);
    assert.equal(harness.chat.filter((item) => item.is_user && item.mes === 'Please continue normally.').length, 1);
    const failedAssistant = harness.chat.at(-1);
    assert.equal(failedAssistant.extra.st_flash.failed, true);

    await harness.controller.retryRecovery();
    session = readSession(harness.metadata);
    assert.equal(session.phase, PHASES.IDLE);
    assert.equal(harness.calls.sendUser.length, 1);
    assert.equal(harness.chat.filter((item) => item.is_user && item.mes === 'Please continue normally.').length, 1);
    assert.match(harness.chat.at(-1).mes, /<internal_states>/);
});

test('disabling ST-FLASH mid-session still permits an explicit clean abort', async () => {
    const harness = await acceptIntoFlash(makeHarness(), 'Abort this Flash session.');
    await harness.controller.handleMessageReceived(harness.chat.length - 1, 'normal');
    assert.equal(readSession(harness.metadata).phase, PHASES.FLASH);
    harness.controller.updateSettings({ enabled: false });
    await harness.controller.abort();

    assert.equal(readSession(harness.metadata).phase, PHASES.IDLE);
    assert.equal(harness.role, 'anchor');
    assert.equal(harness.powerUser.auto_swipe, true);
    assert.equal(harness.powerUser.auto_continue.enabled, true);
    assert.equal(harness.calls.injections.get(INJECTION_KEYS.CAPSULE), '');
    assert.equal(harness.calls.injections.get(INJECTION_KEYS.DELTAS), '');
    assert.equal(harness.calls.injections.get(INJECTION_KEYS.CONTROL), '');
});

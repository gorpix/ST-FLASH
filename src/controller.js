/**
 * ST-FLASH orchestration controller.
 *
 * The controller deliberately knows nothing about the meaning of a capsule
 * or a delta.  Those are model-facing documents.  Its job is to move a chat
 * through the small number of phases, switch the configured role, and keep
 * SillyTavern's transcript usable while the phase is active.
 */

import { INJECTION_KEYS, DEFAULT_SETTINGS, mergeSettings } from './config.js';
import {
    applyStoredIgnoreIds,
    markMessagesIgnored,
} from './context-filter.js';
import {
    parseAnchorHandoff,
    parseFlashCapsule,
    parseFlashOutput,
} from './protocol-parser.js';
import {
    PHASES,
    clearSession,
    createEmptySession,
    readSession,
    recordFlashTurn,
    startSession,
    transitionSession,
    updateSession,
    writeSession,
} from './session-store.js';

const DEFAULT_CAPSULE_QUIET_PROMPT = [
    'Generate the ST-FLASH capsule for the latest Anchor opening.',
    'The latest Anchor reply is the start of the possible Flash exchange.',
    'Do not continue the roleplay and do not write a response to the user.',
    'Return exactly one <flash_capsule>...</flash_capsule> wrapper and nothing outside it.',
].join('\n');

const DEFAULT_LANDING_BASELINE = 5;

function text(value) {
    return String(value ?? '');
}

function nonEmpty(value) {
    const result = text(value);
    return result.trim() ? result : null;
}

function cloneJson(value, fallback = null) {
    if (value === undefined) return fallback;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return fallback;
    }
}

function errorInfo(error, operation = null) {
    return {
        code: error?.code || 'ST_FLASH_OPERATION_FAILED',
        message: error?.message || text(error) || 'ST-FLASH operation failed.',
        operation,
    };
}

function messageId(message, index) {
    if (message?.extra?.st_flash?.uid) return message.extra.st_flash.uid;
    if (message?.id != null) return message.id;
    if (message?.messageId != null) return message.messageId;
    if (message?.message_id != null) return message.message_id;
    return index;
}

function createMessageUid() {
    try {
        if (globalThis.crypto?.randomUUID) return `stf-msg-${globalThis.crypto.randomUUID()}`;
    } catch {
        // A stable orchestration ID is not a security token.
    }
    return `stf-msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensureMessageId(message, index) {
    const existing = messageId(message, index);
    if (typeof existing === 'string' && existing.startsWith('stf-msg-')) return existing;
    if (message?.id != null || message?.messageId != null || message?.message_id != null) return existing;
    if (!message || typeof message !== 'object') return existing;
    message.extra = message.extra && typeof message.extra === 'object' ? message.extra : {};
    message.extra.st_flash = message.extra.st_flash && typeof message.extra.st_flash === 'object'
        ? message.extra.st_flash : {};
    message.extra.st_flash.uid ||= createMessageUid();
    return message.extra.st_flash.uid;
}

function idsEqual(left, right) {
    return Object.is(left, right) || text(left) === text(right);
}

function uniqueIds(values) {
    const result = [];
    for (const value of values ?? []) {
        if (value == null || result.some((candidate) => idsEqual(candidate, value))) continue;
        result.push(value);
    }
    return result;
}

function findMessageIndex(messages, id) {
    return (messages ?? []).findIndex((message, index) => idsEqual(messageId(message, index), id));
}

function rangeIds(messages, endInclusive) {
    const ids = [];
    const end = Math.min(Number(endInclusive), Math.max(0, (messages?.length ?? 0) - 1));
    for (let index = 0; index <= end; index += 1) ids.push(ensureMessageId(messages[index], index));
    return ids;
}

function isAssistantMessage(message) {
    return Boolean(message && !message.is_user && !message.is_system);
}

function hasInternalStates(message) {
    return /<internal_states\b|\bINTERNAL STATES\b|^INTERNAL STATES\b/im.test(text(message?.mes));
}

function hasCompleteInternalStates(message) {
    return /<internal_states\b[\s\S]*<\/internal_states\s*>/i.test(text(message?.mes));
}

function visibleProse(message) {
    return text(message?.mes)
        .replace(/<!--\s*GFX_START\s*-->[\s\S]*?<!--\s*GFX_END\s*-->\s*(?:<\/internal_states\s*>)?/gi, '')
        .replace(/<internal_states\b[\s\S]*<\/internal_states\s*>/gi, '')
        .trim();
}

function hasForbiddenProtocol(message) {
    return /<flash_(?:handoff|capsule|delta|escalate)\b/i.test(text(message?.mes));
}

function capsuleBodyIssues(value, expectedEntry = null) {
    const body = text(value).trim();
    const issues = [];
    if (body.length < 120) issues.push('body is shorter than 120 characters');

    // Preserve a useful structural floor while tolerating harmless Markdown
    // decoration such as "**LOCAL FRAME:**" or "## RECENT CONTEXT".
    const headings = new Set(body.split(/\r?\n/u).map((line) => line
        .trim()
        .replace(/^#{1,6}\s*/u, '')
        .replace(/[*_`]/gu, '')
        .replace(/[:\s]+$/u, '')
        .replace(/[\s_-]+/gu, ' ')
        .toUpperCase()));
    const entryMatch = /^\s*ENTRY:\s*(AUTO|USER)\s*$/imu.exec(body);
    if (!entryMatch) issues.push('missing a valid ENTRY field');
    else if (expectedEntry && entryMatch[1].toUpperCase() !== String(expectedEntry).toUpperCase()) {
        issues.push(`ENTRY is ${entryMatch[1].toUpperCase()}, expected ${String(expectedEntry).toUpperCase()}`);
    }
    for (const heading of ['LOCAL FRAME', 'RECENT CONTEXT', 'AUTHORIZED LOCAL ACTORS']) {
        if (!headings.has(heading)) issues.push(`missing ${heading}`);
    }
    return issues;
}

function wrapperlessCapsuleCandidate(value) {
    const source = text(value).replace(/^\uFEFF/u, '');
    const entryStart = source.search(/^\s*ENTRY:\s*(?:AUTO|USER)\s*$/imu);
    if (entryStart < 0) return null;
    return source
        .slice(entryStart)
        .replace(/\n\s*```(?:text|xml)?\s*$/iu, '')
        .trim();
}

function capsuleResponseDiagnostic(value) {
    const source = text(value);
    const headings = ['LOCAL FRAME', 'RECENT CONTEXT', 'AUTHORIZED LOCAL ACTORS']
        .filter((heading) => new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?${heading}(?:\\*\\*)?\\s*:`, 'imu').test(source));
    return `received ${source.length} characters; ENTRY ${/^\s*ENTRY:\s*(?:AUTO|USER)\s*$/imu.test(source) ? 'present' : 'absent'}; core headings ${headings.length}/3`;
}

function syntheticMissingDelta() {
    return {
        raw: null,
        synthetic: true,
        body: [
            'TIME: N/A',
            'POSITION: N/A',
            'CONDITION: N/A',
            'KNOWLEDGE: N/A',
            'PROPOSAL: N/A',
            'POSSESSION: N/A',
            'COMMITMENT: N/A',
            'OTHER: Flash model omitted its delta; Landing must reconcile this turn from the visible transcript.',
        ].join('\n'),
    };
}

function isMissingDeltaOnly(parsed) {
    return Boolean(parsed?.visible?.trim())
        && !parsed?.delta
        && parsed?.errors?.length === 1
        && parsed.errors[0]?.code === 'FLASH_DELTA_MISSING';
}

function sanitizeModelInjection(value) {
    // SillyTavern expands {{macros}} inside extension prompts. Capsules and
    // deltas are model-generated evidence, never executable prompt source.
    return text(value).replace(/\{\{/g, '{ {').replace(/\}\}/g, '} }');
}

function syncActiveSwipe(message) {
    const swipeId = Number(message?.swipe_id);
    if (Array.isArray(message?.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < message.swipes.length) {
        message.swipes[swipeId] = message.mes;
    }
}

function isPromiseLike(value) {
    return Boolean(value && typeof value.then === 'function');
}

/** A very small promise mutex. It avoids duplicate UI taps without blocking event callbacks. */
class AsyncMutex {
    constructor() {
        this.tail = Promise.resolve();
    }

    run(task) {
        const next = this.tail.then(task, task);
        this.tail = next.catch(() => undefined);
        return next;
    }
}

export class FlashControllerError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'FlashControllerError';
        this.code = details.code || 'ST_FLASH_CONTROLLER_FAILED';
        this.operation = details.operation;
        this.cause = details.cause;
    }
}

/**
 * @typedef {object} FlashControllerDependencies
 * @property {Function} getContext SillyTavern getContext function.
 * @property {object} eventSource SillyTavern event emitter.
 * @property {object} eventTypes SillyTavern event type constants.
 * @property {object} roleSwitcher RoleSwitcher instance.
 * @property {object} summaryception SummaryceptionAdapter instance.
 * @property {object} [ui] UI adapter.
 * @property {Function} generateQuietPrompt Hidden capsule generation function.
 * @property {Function} generate Generate function for normal/continue calls.
 * @property {Function} sendMessageAsUser Direct user-message insertion function.
 * @property {Function} [setExtensionPrompt] Dynamic prompt injection function.
 * @property {Function} [updateMessageBlock] Message renderer refresh function.
 * @property {Function} [saveMetadataDebounced] Chat metadata persistence function.
 * @property {Function} [saveChat] Chat persistence function.
 * @property {symbol} [ignoreSymbol] Runtime SillyTavern ignore symbol.
 * @property {object} [settings] ST-FLASH settings.
 */

export class FlashController {
    constructor(dependencies = {}) {
        this.getContext = dependencies.getContext || (() => globalThis.SillyTavern?.getContext?.());
        this.eventSource = dependencies.eventSource || this.getContext()?.eventSource;
        this.eventTypes = dependencies.eventTypes || this.getContext()?.eventTypes || this.getContext()?.event_types || {};
        this.roleSwitcher = dependencies.roleSwitcher;
        this.summaryception = dependencies.summaryception;
        this.ui = dependencies.ui || null;
        this.generateQuietPrompt = dependencies.generateQuietPrompt;
        this.generate = dependencies.generate;
        this.sendMessageAsUser = dependencies.sendMessageAsUser;
        this.setExtensionPrompt = dependencies.setExtensionPrompt;
        this.updateMessageBlock = dependencies.updateMessageBlock;
        this.saveMetadataDebounced = dependencies.saveMetadataDebounced;
        this.saveMetadata = dependencies.saveMetadata;
        this.saveChat = dependencies.saveChat;
        this.stopGeneration = dependencies.stopGeneration;
        this.powerUser = dependencies.powerUser || null;
        this.ignoreSymbol = dependencies.ignoreSymbol || Symbol.for('ignore');
        this.settings = mergeSettings(dependencies.settings || DEFAULT_SETTINGS);
        this.logger = dependencies.logger || console;
        this.now = dependencies.now || (() => Date.now());
        this.mutex = new AsyncMutex();
        this.attached = false;
        this.bound = {};
        this.activeChatKey = null;
        this.activeChatRef = null;
        this.activeMetadataRef = null;
        this.runtimeIgnoreIds = [];
        this.runtimeArchiveIds = [];
        this.autoLandQueued = false;
        this.activeGeneration = null;
        this.generationSequence = 0;
        this.chatChangeTail = Promise.resolve();
    }

    setUi(ui) {
        this.ui = ui || null;
        return this.ui;
    }

    updateSettings(settings = {}) {
        this.settings = mergeSettings({ ...this.settings, ...settings });
        return this.settings;
    }

    getUiCallbacks() {
        return {
            onAccept: (value) => this.acceptFlash(value),
            onEnterFlash: (value) => this.acceptFlash(value),
            onDecline: (value) => this.decline(value),
            onAnswerNormally: (value) => this.decline(value),
            onCancel: () => this.cancelOffer(),
            onCancelOffer: () => this.cancelOffer(),
            onLand: () => this.land(),
            onAbort: () => this.abort(),
            onRetry: () => this.retryRecovery(),
            onReset: () => this.abort(),
        };
    }

    attach() {
        if (this.attached || !this.eventSource?.on) return this;
        this.attached = true;
        this.bound.messageReceived = (...args) => this.handleMessageReceived(...args);
        this.bound.chatChanged = (...args) => this.queueChatChanged(...args);
        this.bound.appReady = (...args) => this.queueChatChanged(...args);
        this.bound.generationStarted = (...args) => this.handleGenerationStarted(...args);
        this.bound.generationEnded = (...args) => this.handleGenerationFinished('ended', ...args);
        this.bound.generationStopped = (...args) => this.handleGenerationFinished('stopped', ...args);
        this.bound.messageSwiped = (...args) => this.handleMessageSwiped(...args);
        this.eventSource.on(this.eventTypes.MESSAGE_RECEIVED, this.bound.messageReceived);
        this.eventSource.on(this.eventTypes.CHAT_CHANGED, this.bound.chatChanged);
        if (this.eventTypes.APP_READY) this.eventSource.on(this.eventTypes.APP_READY, this.bound.appReady);
        if (this.eventTypes.GENERATION_STARTED) this.eventSource.on(this.eventTypes.GENERATION_STARTED, this.bound.generationStarted);
        if (this.eventTypes.GENERATION_ENDED) this.eventSource.on(this.eventTypes.GENERATION_ENDED, this.bound.generationEnded);
        if (this.eventTypes.GENERATION_STOPPED) this.eventSource.on(this.eventTypes.GENERATION_STOPPED, this.bound.generationStopped);
        if (this.eventTypes.MESSAGE_SWIPED) this.eventSource.on(this.eventTypes.MESSAGE_SWIPED, this.bound.messageSwiped);
        // A session can survive a page reload. Reapply its runtime filters.
        if (!this.eventTypes.APP_READY) void this.queueChatChanged();
        return this;
    }

    detach() {
        if (!this.attached || !this.eventSource?.removeListener) return this;
        this.eventSource.removeListener(this.eventTypes.MESSAGE_RECEIVED, this.bound.messageReceived);
        this.eventSource.removeListener(this.eventTypes.CHAT_CHANGED, this.bound.chatChanged);
        if (this.eventTypes.APP_READY) this.eventSource.removeListener(this.eventTypes.APP_READY, this.bound.appReady);
        if (this.eventTypes.GENERATION_STARTED) this.eventSource.removeListener(this.eventTypes.GENERATION_STARTED, this.bound.generationStarted);
        if (this.eventTypes.GENERATION_ENDED) this.eventSource.removeListener(this.eventTypes.GENERATION_ENDED, this.bound.generationEnded);
        if (this.eventTypes.GENERATION_STOPPED) this.eventSource.removeListener(this.eventTypes.GENERATION_STOPPED, this.bound.generationStopped);
        if (this.eventTypes.MESSAGE_SWIPED) this.eventSource.removeListener(this.eventTypes.MESSAGE_SWIPED, this.bound.messageSwiped);
        this.attached = false;
        return this;
    }

    context() {
        return this.getContext?.() || {};
    }

    chat() {
        return this.context()?.chat || [];
    }

    metadata() {
        const context = this.context();
        if (!context.chatMetadata || typeof context.chatMetadata !== 'object') context.chatMetadata = {};
        return context.chatMetadata;
    }

    chatKey() {
        const context = this.context();
        try {
            return context.getCurrentChatId?.() ?? context.chatId ?? context.groupId ?? context.characterId ?? null;
        } catch {
            return null;
        }
    }

    captureContextToken(session = this.readSession()) {
        return {
            chatKey: this.chatKey(),
            chatRef: this.chat(),
            metadataRef: this.metadata(),
            sessionId: session?.sessionId ?? null,
        };
    }

    isContextTokenCurrent(token) {
        if (!token) return true;
        const session = this.readSession();
        return token.chatRef === this.chat()
            && token.metadataRef === this.metadata()
            && token.chatKey === this.chatKey()
            && token.sessionId === session.sessionId;
    }

    assertContextToken(token, operation) {
        if (this.isContextTokenCurrent(token)) return;
        throw new FlashControllerError('The active chat or ST-FLASH session changed during generation.', {
            code: 'STALE_OPERATION_CONTEXT',
            operation,
        });
    }

    async handleOperationFailure(error, operation, token = null) {
        if (!token || this.isContextTokenCurrent(token)) return this.enterRecovery(error, operation);
        const info = errorInfo(error, operation);
        try {
            const oldSession = readSession(token.metadataRef);
            writeSession(token.metadataRef, { ...oldSession, phase: PHASES.RECOVERY, error: info });
        } catch { /* the old chat may already have been unloaded */ }
        this.logger.error?.('[ST-FLASH] stale operation was abandoned after a chat change', info);
        return info;
    }

    readSession() {
        return readSession(this.metadata());
    }

    writeSession(session) {
        const value = writeSession(this.metadata(), session);
        this.persistMetadata();
        return value;
    }

    updateSession(patch) {
        const value = updateSession(this.metadata(), patch);
        this.persistMetadata();
        return value;
    }

    transition(phase, fields = {}, options = {}) {
        const value = transitionSession(this.metadata(), phase, fields, options);
        this.persistMetadata();
        return value;
    }

    async persistMetadata({ immediate = false, throwOnError = false } = {}) {
        try {
            const saver = immediate && typeof this.saveMetadata === 'function'
                ? this.saveMetadata
                : this.saveMetadataDebounced;
            const result = saver?.();
            if (isPromiseLike(result)) await result;
            return true;
        } catch (error) {
            this.logger.warn?.('[ST-FLASH] metadata save failed', error);
            if (throwOnError) throw error;
        }
        return false;
    }

    async persistChat({ throwOnError = false } = {}) {
        try {
            const result = this.saveChat?.();
            if (isPromiseLike(result)) await result;
            return true;
        } catch (error) {
            this.logger.warn?.('[ST-FLASH] chat save failed', error);
            if (throwOnError) throw error;
        }
        return false;
    }

    callUi(method, payload) {
        try {
            const fn = this.ui?.[method];
            if (typeof fn === 'function') return fn.call(this.ui, payload);
        } catch (error) {
            this.logger.warn?.(`[ST-FLASH] UI ${method} failed`, error);
        }
        return undefined;
    }

    async clearUi() {
        const result = this.callUi('clearRuntime');
        if (isPromiseLike(result)) await result;
    }

    clearComposerIfUnchanged(expected) {
        const current = text(this.callUi('readComposer'));
        if (current === text(expected)) this.callUi('setComposer', '');
    }

    automationSnapshot() {
        if (!this.powerUser) return null;
        return {
            autoSwipe: Boolean(this.powerUser.auto_swipe),
            autoContinue: Boolean(this.powerUser.auto_continue?.enabled),
        };
    }

    disableHostAutomation() {
        if (!this.powerUser) return;
        this.powerUser.auto_swipe = false;
        if (this.powerUser.auto_continue && typeof this.powerUser.auto_continue === 'object') {
            this.powerUser.auto_continue.enabled = false;
        }
    }

    restoreHostAutomation(snapshot) {
        if (!this.powerUser || !snapshot) return;
        this.powerUser.auto_swipe = Boolean(snapshot.autoSwipe);
        if (this.powerUser.auto_continue && typeof this.powerUser.auto_continue === 'object') {
            this.powerUser.auto_continue.enabled = Boolean(snapshot.autoContinue);
        }
    }

    inject(key, value) {
        if (typeof this.setExtensionPrompt !== 'function') return;
        if (!value) {
            // SillyTavern does not expose a deletion helper; an empty value is
            // the supported way to disable an extension prompt injection.
            this.setExtensionPrompt(key, '', 0, 0, false);
            return;
        }
        this.setExtensionPrompt(key, text(value), 0, 0, false);
    }

    clearInjections() {
        this.inject(INJECTION_KEYS.CAPSULE, '');
        this.inject(INJECTION_KEYS.DELTAS, '');
        this.inject(INJECTION_KEYS.CONTROL, '');
    }

    getMessage(id) {
        const messages = this.chat();
        const index = findMessageIndex(messages, id);
        return index < 0 ? null : messages[index];
    }

    findRecentUserMessageId(value, session = this.readSession()) {
        const messages = this.chat();
        const start = Math.max(-1, this.findHandoffIndex(session));
        for (let index = messages.length - 1; index > start; index -= 1) {
            const message = messages[index];
            if (!message?.is_user) continue;
            if (text(message.mes) === text(value)) return ensureMessageId(message, index);
        }
        return null;
    }

    markIgnored(ids) {
        const messages = this.chat();
        const result = applyStoredIgnoreIds(messages, uniqueIds(ids), this.ignoreSymbol);
        this.runtimeIgnoreIds = uniqueIds([...this.runtimeIgnoreIds, ...result.matchedIds]);
        return result;
    }

    markTemporarilyIgnored(ids) {
        const result = this.markIgnored(ids);
        const newlyOwned = result.snapshot
            .filter((entry) => !entry.hadKey)
            .map((entry) => entry.id);
        return { ...result, newlyOwned };
    }

    markFailedMessage(message, index, operation, details = null) {
        if (!message) return null;
        const id = ensureMessageId(message, index);
        message.extra = message.extra && typeof message.extra === 'object' ? message.extra : {};
        message.extra.st_flash = {
            ...(message.extra.st_flash || {}),
            failed: true,
            failedOperation: operation,
            failureDetails: cloneJson(details, null),
        };
        const applied = this.markTemporarilyIgnored([id]);
        this.updateSession((session) => ({
            failedMessageIds: uniqueIds([...(session.failedMessageIds || []), id]),
            ownedIgnoreMessageIds: uniqueIds([...(session.ownedIgnoreMessageIds || []), ...applied.newlyOwned]),
        }));
        return id;
    }

    /** Remove only the runtime ignore flag from IDs owned by this session. */
    unmarkIgnored(ids) {
        return this.unmarkIgnoredFrom(this.chat(), ids);
    }

    unmarkIgnoredFrom(messages, ids) {
        const wanted = uniqueIds(ids);
        for (const [index, message] of (messages || []).entries()) {
            const id = messageId(message, index);
            if (!wanted.some((candidate) => idsEqual(candidate, id))) continue;
            if (message?.extra && typeof message.extra === 'object') delete message.extra[this.ignoreSymbol];
        }
        this.runtimeIgnoreIds = this.runtimeIgnoreIds.filter((id) => !wanted.some((candidate) => idsEqual(candidate, id)));
    }

    reapplyArchivedFilters(session = this.readSession()) {
        const ids = uniqueIds([
            ...(session.archivedMessageIds || []),
            ...this.chat().flatMap((message, index) => (
                message?.extra?.st_flash?.archived ? [ensureMessageId(message, index)] : []
            )),
        ]);
        if (ids.length) this.markIgnored(ids);
        return ids;
    }

    findHandoffIndex(session = this.readSession()) {
        const messages = this.chat();
        const bySession = messages.findIndex((message) => (
            message?.extra?.st_flash?.handoffSessionId === session.sessionId
        ));
        return bySession >= 0 ? bySession : findMessageIndex(messages, session.handoffMessageId);
    }

    archiveCompositeRange(session, endExclusive) {
        const messages = this.chat();
        const start = this.findHandoffIndex(session);
        if (start < 0) throw new FlashControllerError('The Anchor handoff message is missing.', {
            code: 'HANDOFF_MESSAGE_MISSING',
            operation: 'landing',
        });
        const archived = [];
        for (let index = start; index < Math.min(endExclusive, messages.length); index += 1) {
            const message = messages[index];
            if (!message) continue;
            const id = ensureMessageId(message, index);
            message.extra = message.extra && typeof message.extra === 'object' ? message.extra : {};
            message.extra.st_flash = message.extra.st_flash && typeof message.extra.st_flash === 'object'
                ? message.extra.st_flash : {};
            message.extra.st_flash.archived = true;
            message.extra.st_flash.archivedSessionId = session.sessionId;
            // Persistent hiding keeps raw Flash turns out of both ordinary ST
            // prompts and Summaryception catch-up after the Landing replaces them.
            message.is_system = true;
            message.extra[this.ignoreSymbol] = true;
            archived.push(id);
        }
        return uniqueIds(archived);
    }

    archiveMessageIds(ids, sessionId) {
        const messages = this.chat();
        const archived = [];
        for (const id of uniqueIds(ids)) {
            const index = findMessageIndex(messages, id);
            const message = index >= 0 ? messages[index] : null;
            if (!message) continue;
            const stableId = ensureMessageId(message, index);
            message.extra = message.extra && typeof message.extra === 'object' ? message.extra : {};
            message.extra.st_flash = {
                ...(message.extra.st_flash || {}),
                archived: true,
                archivedSessionId: sessionId,
            };
            message.is_system = true;
            message.extra[this.ignoreSymbol] = true;
            archived.push(stableId);
        }
        return archived;
    }

    baselineIds(session, count = this.settings.landingBaselineMessages ?? DEFAULT_LANDING_BASELINE) {
        const messages = this.chat();
        const handoffIndex = this.findHandoffIndex(session);
        if (handoffIndex < 0) return [];
        const candidates = [];
        for (let index = 0; index < handoffIndex; index += 1) {
            const message = messages[index];
            if (!message || message.is_system || message.extra?.st_flash?.archived) continue;
            candidates.push(index);
        }
        const ids = candidates.slice(-Math.max(0, Number(count) || 0)).map((index) => messageId(messages[index], index));
        for (let index = handoffIndex - 1; index >= 0; index -= 1) {
            if (!messages[index]?.is_system && !messages[index]?.extra?.st_flash?.archived && hasInternalStates(messages[index])) {
                ids.push(messageId(messages[index], index));
                break;
            }
        }
        return uniqueIds(ids);
    }

    flashCapsuleInjection(capsule) {
        return `<flash_capsule>\n${sanitizeModelInjection(capsule).trim()}\n</flash_capsule>`;
    }

    deltaInjection(deltas) {
        if (!Array.isArray(deltas) || deltas.length === 0) return '';
        const body = deltas.map((delta, index) => {
            const content = typeof delta === 'string' ? delta : (delta?.body ?? delta?.raw ?? JSON.stringify(delta));
            const turn = Number.isInteger(delta?.turn) ? delta.turn : index + 1;
            return `F${turn}:\n${sanitizeModelInjection(content).trim()}`;
        }).join('\n\n');
        return `<flash_deltas>\n${body}\n</flash_deltas>`;
    }

    flashControlInjection() {
        return [
            'FLASH MODE IS ACTIVE.',
            'Answer only the newest user turn using the capsule, visible Flash transcript, and accumulated deltas.',
            'If escalation is required, append exactly <flash_escalate>. Do not write the Landing response yourself.',
            'Append exactly one <flash_delta> for this response.',
        ].join('\n');
    }

    capsuleRequestPrompt(session) {
        const entry = session?.entry === 'USER' ? 'USER' : 'AUTO';
        return [
            this.settings.capsuleQuietPrompt || DEFAULT_CAPSULE_QUIET_PROMPT,
            '',
            `The authoritative terminal marker was <flash_handoff entry="${entry}"/>.`,
            `The capsule ENTRY field must be ${entry}.`,
        ].join('\n');
    }

    queueChatChanged(...args) {
        const session = this.readSession();
        if (session.phase !== PHASES.IDLE) {
            this.activeGeneration = null;
            try { this.stopGeneration?.(); } catch { /* optional host API */ }
        }
        this.chatChangeTail = this.chatChangeTail
            .catch(() => undefined)
            .then(() => this.handleChatChanged(...args));
        return this.chatChangeTail;
    }

    async handleGenerationStarted(type, _options = {}, dryRun = false) {
        if (dryRun) return;
        const session = this.readSession();
        if (session.phase !== PHASES.FLASH) return;
        if (type !== 'normal') {
            const error = new FlashControllerError(`Generation type ${String(type)} is disabled during Flash.`, {
                code: 'FLASH_GENERATION_TYPE_BLOCKED',
                operation: 'flash-reply',
            });
            try { this.stopGeneration?.(); } catch { /* optional host API */ }
            await this.enterRecovery(error, 'flash-reply');
            throw error;
        }

        this.callUi('showFlashStatus', {
            session,
            canLand: false,
            generating: true,
            onLand: () => this.land(),
            onAbort: () => this.abort(),
        });
        try {
            await this.roleSwitcher?.switchTo?.('flash');
            this.activeGeneration = {
                id: ++this.generationSequence,
                sessionId: session.sessionId,
                chatKey: this.chatKey(),
                chatRef: this.chat(),
                metadataRef: this.metadata(),
                type,
                finished: false,
            };
        } catch (error) {
            try { this.stopGeneration?.(); } catch { /* optional host API */ }
            await this.enterRecovery(error, 'flash-entry');
            throw error;
        }
    }

    handleGenerationFinished(reason) {
        const session = this.readSession();
        if (reason === 'stopped') {
            this.activeGeneration = null;
            this.autoLandQueued = false;
        }
        if (reason === 'ended' && this.activeGeneration) {
            // Some SillyTavern/provider combinations emit GENERATION_ENDED
            // before MESSAGE_RECEIVED. Keep the ownership record alive for
            // message validation, but remember that Landing may start as soon
            // as the response has been parsed and persisted.
            this.activeGeneration.finished = true;
        }
        if (reason === 'ended' && session.phase === PHASES.FLASH && this.autoLandQueued && !this.activeGeneration) {
            // MESSAGE_RECEIVED fires before SillyTavern fully releases its
            // generation lock. Start Landing only after GENERATION_ENDED;
            // otherwise Generate('normal') can return without creating a
            // message and surface as EMPTY_ASSISTANT_RESPONSE.
            this.autoLandQueued = false;
            setTimeout(() => void this.land(), 0);
            return;
        }
        if (session.phase === PHASES.FLASH && !this.activeGeneration) {
            this.callUi('showFlashStatus', {
                session,
                canLand: true,
                generating: false,
                onLand: () => this.land(),
                onAbort: () => this.abort(),
            });
        }
    }

    async handleMessageSwiped(messageIndex) {
        const session = this.readSession();
        if (session.phase !== PHASES.OFFERED) return;
        const index = Number(messageIndex);
        if (!Number.isInteger(index) || !idsEqual(messageId(this.chat()[index], index), session.handoffMessageId)) return;
        await this.mutex.run(async () => {
            this.transition(PHASES.IDLE, { pendingUserText: null, entry: null }, { strict: false });
            const message = this.chat()[index];
            if (message?.extra?.st_flash) {
                delete message.extra.st_flash.handoffHandled;
                delete message.extra.st_flash.handoffSessionId;
                delete message.extra.st_flash.entry;
            }
            await this.clearUi();
        });
        await this.handleMessageReceived(index, 'swipe');
    }

    async handleChatChanged() {
        const context = this.context();
        const key = this.chatKey();
        const nextMetadata = context.chatMetadata && typeof context.chatMetadata === 'object'
            ? context.chatMetadata : {};

        // Prompt injections, provider role, and Summaryception settings are
        // global. When the user changes chats, release the old chat's runtime
        // view without destroying its persisted resumable session.
        if (this.activeMetadataRef && this.activeMetadataRef !== nextMetadata) {
            const previousSession = readSession(this.activeMetadataRef);
            if (previousSession.phase !== PHASES.IDLE) {
                try { this.stopGeneration?.(); } catch { /* optional host API */ }
            }
            this.activeGeneration = null;
            try {
                this.clearInjections();
                this.unmarkIgnoredFrom(this.activeChatRef || [], previousSession.ownedIgnoreMessageIds || []);
                if (previousSession.previousSummaryception) {
                    await this.summaryception?.restore?.(previousSession.previousSummaryception, { persist: true });
                }
                this.restoreHostAutomation(previousSession.previousAutomation);
                if (previousSession.previousRole) await this.roleSwitcher?.restore?.(previousSession.previousRole);
            } catch (error) {
                this.logger.error?.('[ST-FLASH] failed to release previous chat runtime', error);
            }
        }

        let session = readSession(nextMetadata);
        this.activeChatKey = key;
        this.activeChatRef = this.chat();
        this.activeMetadataRef = nextMetadata;
        this.runtimeIgnoreIds = [];
        this.reapplyArchivedFilters(session);

        const resumableIgnoreIds = uniqueIds([...(session.ignoredMessageIds || []), ...(session.failedMessageIds || [])]);
        if (resumableIgnoreIds.length) {
            const reapplied = this.markTemporarilyIgnored(resumableIgnoreIds);
            const owned = uniqueIds([...(session.ownedIgnoreMessageIds || []), ...reapplied.newlyOwned]);
            if (owned.length !== (session.ownedIgnoreMessageIds || []).length) this.updateSession({ ownedIgnoreMessageIds: owned });
        }

        if ([PHASES.CAPSULING, PHASES.LANDING, PHASES.CONTINUING].includes(session.phase)) {
            const interruptedOperation = session.phase === PHASES.CAPSULING
                ? 'capsule'
                : session.phase === PHASES.LANDING
                    ? 'landing'
                    : session.continuationMode === 'USER_REPLY'
                        ? session.continuationUserMessageId ? 'continuation-user' : 'continuation-user-insert'
                        : 'continuation-append';
            session = this.transition(PHASES.RECOVERY, {
                error: {
                    code: 'INTERRUPTED_PHASE',
                    message: `ST-FLASH was reloaded during ${session.phase}.`,
                    operation: interruptedOperation,
                },
            }, { strict: false });
            try {
                this.clearInjections();
                await this.summaryception?.restore?.(session.previousSummaryception, { persist: true });
                this.restoreHostAutomation(session.previousAutomation);
                if (session.previousRole) await this.roleSwitcher?.restore?.(session.previousRole);
            } catch (error) {
                session = this.transition(PHASES.RECOVERY, {
                    error: {
                        ...session.error,
                        cleanup: errorInfo(error, 'reload-cleanup'),
                    },
                }, { strict: false });
            }
        }

        if (session.phase === PHASES.OFFERED) {
            this.callUi('showOffer', { session, entry: session.entry, restored: true });
        } else if (session.phase === PHASES.FLASH) {
            try {
                await this.summaryception?.disableForFlash?.();
                this.disableHostAutomation();
                this.inject(INJECTION_KEYS.CAPSULE, this.flashCapsuleInjection(session.capsule || ''));
                this.inject(INJECTION_KEYS.DELTAS, this.deltaInjection(session.deltas));
                this.inject(INJECTION_KEYS.CONTROL, this.flashControlInjection());
                await this.roleSwitcher?.switchTo?.('flash');
                this.callUi('showFlashStatus', { session, restored: true, onLand: () => this.land(), onAbort: () => this.abort() });
            } catch (error) {
                await this.enterRecovery(error, 'flash-entry');
                session = this.readSession();
            }
        } else if (session.phase === PHASES.RECOVERY) {
            this.callUi('showRecovery', session.error || { message: 'ST-FLASH session needs recovery.' });
        } else if (session.phase === PHASES.IDLE) {
            await this.clearUi();
        }
        return session;
    }

    /** MESSAGE_RECEIVED is awaited by ST, so keep this handler phase-local. */
    async handleMessageReceived(messageIndex, generationType = null) {
        if (!this.settings.enabled) return;
        try {
            const index = Number.isInteger(Number(messageIndex)) ? Number(messageIndex) : this.chat().length - 1;
            const message = this.chat()[index];
            if (!isAssistantMessage(message)) return;
            const session = this.readSession();

            if (session.phase === PHASES.FLASH) {
                await this.handleFlashMessage(index, message, session, generationType);
                return;
            }

            // Internal Landing/Continuation messages must never be fed back
            // through Anchor's router while their generation is in flight.
            if (session.phase !== PHASES.IDLE) return;

            const parsed = parseAnchorHandoff(message.mes);
            if (!parsed.matched) return;
            if (message.extra?.st_flash?.handoffHandled) return;
            if (!this.roleSwitcher?.isCurrentRole?.('anchor')) {
                this.logger.warn?.('[ST-FLASH] ignored handoff marker generated outside the configured Anchor role');
                return;
            }

            const originalText = message.mes;
            const originalFlashExtra = cloneJson(message.extra?.st_flash, null);
            const stableMessageId = ensureMessageId(message, index);
            const previousRole = this.roleSwitcher?.snapshot?.() || null;
            const existing = this.readSession();
            try {
                const created = startSession(this.metadata(), {
                    entry: parsed.entry,
                    handoffMessageId: stableMessageId,
                    anchorMessageId: stableMessageId,
                    previousRole,
                    previousSummaryception: this.summaryception?.snapshot?.() || null,
                    previousAutomation: this.automationSnapshot(),
                    archivedMessageIds: existing.archivedMessageIds || [],
                });
                message.mes = parsed.visible;
                syncActiveSwipe(message);
                message.extra = message.extra && typeof message.extra === 'object' ? message.extra : {};
                message.extra.st_flash = {
                    ...(message.extra.st_flash || {}),
                    handoffHandled: true,
                    entry: parsed.entry,
                    handoffSessionId: created.sessionId,
                };
                await this.persistMetadata({ immediate: true, throwOnError: true });
                await this.persistChat({ throwOnError: true });
                this.activeChatKey = this.chatKey();
                this.activeChatRef = this.chat();
                if (typeof this.updateMessageBlock === 'function') {
                    setTimeout(() => {
                        try { this.updateMessageBlock(index, message); } catch { /* optional UI */ }
                    }, 0);
                }
                this.callUi('showOffer', { session: created, entry: parsed.entry, messageIndex: index });
            } catch (error) {
                message.mes = originalText;
                syncActiveSwipe(message);
                if (originalFlashExtra) message.extra.st_flash = originalFlashExtra;
                else if (message.extra) delete message.extra.st_flash;
                clearSession(this.metadata());
                throw error;
            }
        } catch (error) {
            const session = this.readSession();
            if (session.phase !== PHASES.IDLE) await this.enterRecovery(error, session.phase === PHASES.FLASH ? 'flash-reply' : 'anchor-handoff');
            else this.logger.error?.('[ST-FLASH] message handler failed', error);
        }
    }

    async handleFlashMessage(index, message, session = this.readSession(), generationType = null) {
        if (message.extra?.st_flash?.processedSessionId === session.sessionId) return;
        const generation = this.activeGeneration;
        if (!generation
            || generation.sessionId !== session.sessionId
            || generation.chatRef !== this.chat()
            || generation.metadataRef !== this.metadata()
            || generation.chatKey !== this.chatKey()
            || index !== this.chat().length - 1
            || (generationType && generationType !== generation.type)) {
            throw new FlashControllerError('Received an unowned or stale assistant message during Flash.', {
                code: 'FLASH_MESSAGE_NOT_OWNED',
                operation: 'flash-reply',
            });
        }
        const parsed = parseFlashOutput(message.mes, { requireDelta: true });
        const missingDeltaFallback = isMissingDeltaOnly(parsed);
        const effectiveDelta = missingDeltaFallback ? syntheticMissingDelta() : parsed.delta;
        if ((!parsed.valid && !missingDeltaFallback) || !effectiveDelta?.body?.trim()) {
            this.markFailedMessage(message, index, 'flash-reply', parsed.errors);
            await this.persistMetadata({ immediate: true, throwOnError: true });
            await this.persistChat({ throwOnError: true });
            this.activeGeneration = null;
            const codes = parsed.errors.map((item) => item.code).filter(Boolean);
            throw new FlashControllerError(`Flash response delta is invalid: ${codes.join(', ') || 'unknown protocol error'}.`, {
                code: 'FLASH_OUTPUT_INVALID',
                operation: 'flash-reply',
                cause: parsed.errors,
            });
        }
        const delta = { ...cloneJson(effectiveDelta, effectiveDelta), turn: session.flashTurn + 1 };
        message.mes = parsed.visible;
        syncActiveSwipe(message);
        message.extra = message.extra && typeof message.extra === 'object' ? message.extra : {};
        message.extra.st_flash = {
            ...(message.extra.st_flash || {}),
            processedSessionId: session.sessionId,
            phase: 'FLASH',
            turn: session.flashTurn + 1,
            delta,
            escalation: parsed.escalation ? cloneJson(parsed.escalation, parsed.escalation) : null,
            errors: cloneJson(parsed.errors, []),
            deltaFallback: missingDeltaFallback,
        };
        const stableMessageId = ensureMessageId(message, index);
        const next = recordFlashTurn(this.metadata(), {
            messageId: stableMessageId,
            delta,
        });
        this.inject(INJECTION_KEYS.DELTAS, this.deltaInjection(next.deltas));
        if (typeof this.updateMessageBlock === 'function') {
            setTimeout(() => {
                try { this.updateMessageBlock(index, message); } catch { /* optional UI */ }
            }, 0);
        }
        await this.persistMetadata({ immediate: true, throwOnError: true });
        await this.persistChat({ throwOnError: true });

        // GENERATION_ENDED may have arrived before or during the asynchronous
        // persistence above. Clear ownership only after both writes so an
        // automatic Landing cannot race the accepted Flash message to disk.
        const generationEnded = generation.finished === true;
        this.activeGeneration = null;
        this.callUi('showFlashStatus', {
            session: next,
            turn: next.flashTurn,
            escalation: parsed.escalation,
            errors: parsed.errors,
            canLand: generationEnded && !parsed.escalation,
            generating: !generationEnded,
            onLand: () => this.land(),
            onAbort: () => this.abort(),
        });
        if (parsed.escalation) {
            if (generationEnded) {
                this.autoLandQueued = false;
                setTimeout(() => void this.land(), 0);
            } else {
                this.autoLandQueued = true;
            }
        }
    }

    salvageFailedMissingDelta(session = this.readSession()) {
        const failedIds = session.failedMessageIds || [];
        const id = failedIds[failedIds.length - 1];
        if (id == null) return null;
        const index = findMessageIndex(this.chat(), id);
        const message = index >= 0 ? this.chat()[index] : null;
        const details = message?.extra?.st_flash?.failureDetails;
        if (!message || !Array.isArray(details) || details.length !== 1 || details[0]?.code !== 'FLASH_DELTA_MISSING') return null;

        const parsed = parseFlashOutput(message.mes, { requireDelta: false });
        if (!parsed.valid || parsed.delta || !parsed.visible.trim()) return null;
        const delta = { ...syntheticMissingDelta(), turn: session.flashTurn + 1 };
        message.mes = parsed.visible;
        syncActiveSwipe(message);
        message.extra = message.extra && typeof message.extra === 'object' ? message.extra : {};
        message.extra.st_flash = message.extra.st_flash && typeof message.extra.st_flash === 'object'
            ? message.extra.st_flash : {};
        delete message.extra.st_flash.failed;
        delete message.extra.st_flash.failedOperation;
        delete message.extra.st_flash.failureDetails;
        Object.assign(message.extra.st_flash, {
            processedSessionId: session.sessionId,
            phase: 'FLASH',
            turn: delta.turn,
            delta,
            escalation: parsed.escalation ? cloneJson(parsed.escalation, parsed.escalation) : null,
            errors: [{ code: 'FLASH_DELTA_MISSING', recovered: true }],
            deltaFallback: true,
        });
        const owned = (session.ownedIgnoreMessageIds || []).some((candidate) => idsEqual(candidate, id));
        if (owned) this.unmarkIgnored([id]);
        recordFlashTurn(this.metadata(), { messageId: id, delta });
        const next = this.updateSession((current) => ({
            failedMessageIds: (current.failedMessageIds || []).filter((candidate) => !idsEqual(candidate, id)),
            ownedIgnoreMessageIds: (current.ownedIgnoreMessageIds || []).filter((candidate) => !idsEqual(candidate, id)),
        }));
        this.inject(INJECTION_KEYS.DELTAS, this.deltaInjection(next.deltas));
        if (typeof this.updateMessageBlock === 'function') {
            try { this.updateMessageBlock(index, message); } catch { /* optional UI */ }
        }
        return { session: next, message, parsed };
    }

    async acceptFlash(userText = null) {
        return this.mutex.run(async () => {
            if (!this.settings.enabled) return this.readSession();
            const session = this.readSession();
            const retryingCapsule = session.phase === PHASES.RECOVERY && session.error?.operation === 'capsule';
            if (session.phase !== PHASES.OFFERED && !retryingCapsule) return session;
            const contextToken = this.captureContextToken(session);
            const pending = userText == null ? nonEmpty(this.callUi('readComposer')) : nonEmpty(userText);
            let recoveryOperation = 'capsule';
            try {
                this.transition(PHASES.CAPSULING, { pendingUserText: pending });
                await this.persistMetadata({ immediate: true, throwOnError: true });
                this.callUi('hideOffer');
                this.callUi('showFlashStatus', { phase: PHASES.CAPSULING, pending: Boolean(pending) });
                await this.roleSwitcher.switchTo('capsule');
                this.assertContextToken(contextToken, 'capsule');
                if (typeof this.generateQuietPrompt !== 'function') throw new FlashControllerError('Capsule generation is unavailable.', { code: 'CAPSULE_GENERATOR_UNAVAILABLE' });
                const raw = await this.generateQuietPrompt({
                    quietPrompt: this.capsuleRequestPrompt(session),
                    responseLength: this.settings.capsuleResponseLength,
                    // Kimi providers and reasoning templates do not always
                    // agree about where reasoning ends. Keep the raw response;
                    // capsule parsing extracts only the structured final body.
                    removeReasoning: false,
                });
                this.assertContextToken(contextToken, 'capsule');
                const parsedCapsule = parseFlashCapsule(raw, {
                    // Only the capsule body is forwarded. Ignore harmless
                    // reasoning, Markdown fences, or a short preface outside
                    // the single wrapper instead of wasting a model retry.
                    requireOnlyWrapper: false,
                    expectedEntry: session.entry,
                });
                let capsule = parsedCapsule.capsule;
                let parserErrors = parsedCapsule.errors;
                if (!parsedCapsule.matched) {
                    // A fully structured body is unambiguous even if a fast
                    // model drops only the outer XML tags. Recover it from the
                    // ENTRY line; prose without the required structure still
                    // fails closed.
                    const candidate = wrapperlessCapsuleCandidate(raw);
                    if (candidate && capsuleBodyIssues(candidate, session.entry).length === 0) {
                        capsule = candidate;
                        parserErrors = [];
                    }
                }
                const bodyIssues = capsule ? capsuleBodyIssues(capsule, session.entry) : [];
                if (parserErrors.length || bodyIssues.length || !capsule) {
                    const issueCodes = parserErrors.map((item) => item.code);
                    const details = [...issueCodes, ...bodyIssues, capsuleResponseDiagnostic(raw)];
                    throw new FlashControllerError(`Capsule rejected: ${details.join('; ') || 'unknown format error'}.`, {
                        code: 'CAPSULE_INVALID',
                        cause: { parser: parserErrors, body: bodyIssues },
                    });
                }

                const current = this.readSession();
                this.updateSession({ capsule, pendingUserText: pending });
                const handoffIndex = this.findHandoffIndex(current);
                if (handoffIndex < 0) throw new FlashControllerError('The Anchor handoff message is missing.', {
                    code: 'HANDOFF_MESSAGE_MISSING',
                    operation: 'capsule',
                });
                // Keep A's visible opening as the first canonical Flash beat;
                // only the earlier full-context history is replaced by capsule.
                const ignoredIds = handoffIndex > 0 ? rangeIds(this.chat(), handoffIndex - 1) : [];
                const applied = this.markTemporarilyIgnored(ignoredIds);
                this.updateSession({
                    ignoredMessageIds: uniqueIds(applied.matchedIds),
                    ownedIgnoreMessageIds: uniqueIds(applied.newlyOwned),
                });
                await this.persistMetadata({ immediate: true, throwOnError: true });
                await this.persistChat({ throwOnError: true });
                await this.summaryception?.disableForFlash?.();
                this.assertContextToken(contextToken, 'flash-entry');
                this.disableHostAutomation();
                this.inject(INJECTION_KEYS.CAPSULE, this.flashCapsuleInjection(capsule));
                this.inject(INJECTION_KEYS.DELTAS, '');
                this.inject(INJECTION_KEYS.CONTROL, this.flashControlInjection());
                recoveryOperation = 'flash-entry';
                await this.roleSwitcher.switchTo('flash');
                this.assertContextToken(contextToken, 'flash-entry');
                // Keep pending text in metadata until the direct user-message
                // insertion succeeds. A failed request must be retryable
                // without asking the user to reconstruct their reply.
                this.transition(PHASES.FLASH, { pendingUserText: pending });
                await this.persistMetadata({ immediate: true, throwOnError: true });
                await this.persistChat({ throwOnError: true });
                if (pending) {
                    this.clearComposerIfUnchanged(pending);
                    let insertedId = this.findRecentUserMessageId(pending, this.readSession());
                    if (!insertedId) {
                        const inserted = await this.sendMessageAsUser(pending);
                        this.assertContextToken(contextToken, 'flash-entry');
                        const insertedIndex = this.chat().indexOf(inserted);
                        insertedId = insertedIndex >= 0 ? ensureMessageId(inserted, insertedIndex) : this.findRecentUserMessageId(pending, this.readSession());
                    }
                    this.updateSession({ pendingUserText: null, initialUserMessageId: insertedId });
                    await this.persistMetadata({ immediate: true, throwOnError: true });
                    await this.persistChat({ throwOnError: true });
                    recoveryOperation = 'flash-reply';
                    await this.generateAutomatic();
                    this.assertContextToken(contextToken, 'flash-reply');
                    return this.readSession();
                }
                this.callUi('showFlashStatus', { session: this.readSession(), onLand: () => this.land(), onAbort: () => this.abort() });
                return this.readSession();
            } catch (error) {
                await this.handleOperationFailure(error, recoveryOperation, contextToken);
                return this.readSession();
            }
        });
    }

    async decline(userText = null) {
        return this.mutex.run(async () => {
            if (!this.settings.enabled) return this.readSession();
            const session = this.readSession();
            if (session.phase !== PHASES.OFFERED) return session;
            const contextToken = this.captureContextToken(session);
            const textValue = userText == null ? nonEmpty(this.callUi('readComposer')) : nonEmpty(userText);
            let recoveryOperation = textValue ? 'continuation-user-insert' : 'continuation-append';
            try {
                this.callUi('hideOffer');
                if (textValue) {
                    this.transition(PHASES.CONTINUING, { continuationMode: 'USER_REPLY', pendingUserText: textValue });
                    await this.persistMetadata({ immediate: true, throwOnError: true });
                    this.clearComposerIfUnchanged(textValue);
                    let insertedId = this.findRecentUserMessageId(textValue, this.readSession());
                    if (!insertedId) {
                        const inserted = await this.sendMessageAsUser(textValue);
                        this.assertContextToken(contextToken, 'continuation-user-insert');
                        const insertedIndex = this.chat().indexOf(inserted);
                        insertedId = insertedIndex >= 0 ? ensureMessageId(inserted, insertedIndex) : this.findRecentUserMessageId(textValue, this.readSession());
                    }
                    this.updateSession({ continuationUserMessageId: insertedId });
                    await this.persistMetadata({ immediate: true, throwOnError: true });
                    await this.persistChat({ throwOnError: true });
                    recoveryOperation = 'continuation-user';
                    // The same configurable C-side Continuation preset handles
                    // both decline paths. The prompt receives a mode hint so
                    // it answers the newly inserted user message normally.
                    this.inject(INJECTION_KEYS.CONTROL, [
                        'DECLINE WITH USER TEXT: answer the newest user message as a complete ordinary roleplay response.',
                        'Do not append to or repeat the interrupted Anchor message.',
                    ].join('\n'));
                    await this.roleSwitcher.switchTo('continuation');
                    this.assertContextToken(contextToken, 'continuation-user');
                    await this.generateNewAssistant({ requireStates: true, operation: 'continuation-user' });
                    this.assertContextToken(contextToken, 'continuation-user');
                } else {
                    this.transition(PHASES.CONTINUING, { continuationMode: 'APPEND' });
                    await this.persistMetadata({ immediate: true, throwOnError: true });
                    this.inject(INJECTION_KEYS.CONTROL, [
                        'CONTINUATION MODE: APPEND.',
                        'Continue the existing Anchor assistant message in the same message bubble.',
                    ].join('\n'));
                    await this.roleSwitcher.switchTo('continuation');
                    this.assertContextToken(contextToken, 'continuation-append');
                    await this.generateContinuation({ requireStates: true, operation: 'continuation-append' });
                    this.assertContextToken(contextToken, 'continuation-append');
                }
                await this.finishOrdinaryPhase();
                return this.readSession();
            } catch (error) {
                await this.handleOperationFailure(error, recoveryOperation, contextToken);
                return this.readSession();
            }
        });
    }

    async cancelOffer() {
        return this.mutex.run(async () => {
            const session = this.readSession();
            if (session.phase !== PHASES.OFFERED) return session;
            this.transition(PHASES.IDLE, {
                entry: null,
                handoffMessageId: null,
                anchorMessageId: null,
                pendingUserText: null,
                previousRole: null,
                previousSummaryception: null,
                previousAutomation: null,
                error: null,
            });
            await this.persistMetadata({ immediate: true, throwOnError: true });
            await this.clearUi();
            return this.readSession();
        });
    }

    async land() {
        return this.mutex.run(async () => this.landInternal());
    }

    async landInternal() {
        const session = this.readSession();
        if (session.phase !== PHASES.FLASH
            && !(session.phase === PHASES.RECOVERY && session.error?.operation === 'landing')) return session;
        if (this.activeGeneration) return session;
        const contextToken = this.captureContextToken(session);
        try {
            this.transition(PHASES.LANDING, { error: null });
            await this.persistMetadata({ immediate: true, throwOnError: true });
            this.callUi('setInteractionMode', 'busy');
            await this.roleSwitcher.switchTo('landing');
            this.assertContextToken(contextToken, 'landing');
            const baseline = this.baselineIds(session, this.settings.landingBaselineMessages ?? DEFAULT_LANDING_BASELINE);
            const ownedBaseline = baseline.filter((id) => (session.ownedIgnoreMessageIds || []).some((owned) => idsEqual(owned, id)));
            this.unmarkIgnored(ownedBaseline);
            this.inject(INJECTION_KEYS.CAPSULE, this.flashCapsuleInjection(session.capsule || ''));
            this.inject(INJECTION_KEYS.DELTAS, this.deltaInjection(session.deltas));
            this.inject(INJECTION_KEYS.CONTROL, [
                'The Flash transcript in the chat is the actual exchange.',
                'Reconcile it and produce the concluding prose plus the complete final Internal States.',
                'Do not output an audit or a capsule.',
            ].join('\n'));
            // A Flash transcript ends on an assistant message. SillyTavern's
            // normal generator does not reliably create another assistant
            // message without an intervening user turn. Continue the final
            // Flash bubble under the Landing role, validate the appended text,
            // then replace that bubble with the canonical Landing response.
            await this.generateLandingReplacement({ requireStates: true, operation: 'landing' });
            this.assertContextToken(contextToken, 'landing');
            const messages = this.chat();
            const landingIndex = messages.length - 1;
            if (isAssistantMessage(messages[landingIndex])) {
                messages[landingIndex].extra = messages[landingIndex].extra && typeof messages[landingIndex].extra === 'object'
                    ? messages[landingIndex].extra : {};
                messages[landingIndex].extra.st_flash = {
                    ...(messages[landingIndex].extra.st_flash || {}),
                    phase: 'LANDING',
                    sessionId: session.sessionId,
                };
            }

            // Restore the ordinary pre-Flash context, then persistently archive
            // only A's opening plus the raw Flash transcript. The new Landing
            // response remains the canonical replacement visible to future A.
            this.unmarkIgnored(session.ownedIgnoreMessageIds || []);
            const currentArchiveIds = this.archiveCompositeRange(session, landingIndex);
            const archiveIds = uniqueIds([...(session.archivedMessageIds || []), ...currentArchiveIds]);
            this.markIgnored(archiveIds);
            this.runtimeArchiveIds = archiveIds;
            this.clearInjections();
            await this.summaryception?.restore?.(session.previousSummaryception, { persist: true });
            this.restoreHostAutomation(session.previousAutomation);
            await this.roleSwitcher.restore(session.previousRole);
            this.transition(PHASES.IDLE, {
                entry: null,
                handoffMessageId: null,
                anchorMessageId: null,
                capsule: null,
                pendingUserText: null,
                continuationMode: null,
                initialUserMessageId: null,
                continuationUserMessageId: null,
                ignoredMessageIds: [],
                ownedIgnoreMessageIds: [],
                failedMessageIds: [],
                archivedMessageIds: archiveIds,
                deltas: [],
                flashTurn: 0,
                flashMessageIds: [],
                previousRole: null,
                previousSummaryception: null,
                previousAutomation: null,
                error: null,
            }, { strict: true });
            await this.persistMetadata({ immediate: true, throwOnError: true });
            await this.persistChat({ throwOnError: true });
            await this.clearUi();
            return this.readSession();
        } catch (error) {
            await this.handleOperationFailure(error, 'landing', contextToken);
            return this.readSession();
        }
    }

    async generateAutomatic() {
        if (typeof this.generate !== 'function') throw new FlashControllerError('SillyTavern Generate is unavailable.', { code: 'GENERATOR_UNAVAILABLE' });
        return this.generate('normal', { automatic_trigger: true });
    }

    async generateNewAssistant({ requireStates = false, operation = 'generation' } = {}) {
        const beforeLength = this.chat().length;
        await this.generateAutomatic();
        const messages = this.chat();
        const message = messages[messages.length - 1];
        if (messages.length <= beforeLength || !isAssistantMessage(message) || !text(message.mes).trim()) {
            throw new FlashControllerError('Generation did not create a new assistant response.', {
                code: 'EMPTY_ASSISTANT_RESPONSE',
                operation,
            });
        }
        const validationError = hasForbiddenProtocol(message)
            ? new FlashControllerError('Generated response leaked ST-FLASH protocol markup.', {
                code: 'FORBIDDEN_PROTOCOL_OUTPUT',
                operation,
            })
            : requireStates && !hasCompleteInternalStates(message)
                ? new FlashControllerError('Generated response has no complete Internal States block.', {
                    code: 'INTERNAL_STATES_MISSING',
                    operation,
                })
                : requireStates && visibleProse(message).length < 20
                    ? new FlashControllerError('Generated response contains Internal States but no concluding prose.', {
                        code: 'LANDING_PROSE_MISSING',
                        operation,
                    })
                    : null;
        if (validationError) {
            this.markFailedMessage(message, messages.length - 1, operation, errorInfo(validationError, operation));
            await this.persistMetadata({ immediate: true, throwOnError: true });
            await this.persistChat({ throwOnError: true });
            throw validationError;
        }
        return message;
    }

    async generateContinue() {
        if (typeof this.generate !== 'function') throw new FlashControllerError('SillyTavern Generate is unavailable.', { code: 'GENERATOR_UNAVAILABLE' });
        return this.generate('continue', { automatic_trigger: true });
    }

    async generateContinuation({ requireStates = false, operation = 'continuation' } = {}) {
        const messages = this.chat();
        const beforeLength = messages.length;
        const target = messages[beforeLength - 1];
        const beforeText = text(target?.mes);
        if (!isAssistantMessage(target)) {
            throw new FlashControllerError('There is no assistant response to continue.', {
                code: 'CONTINUATION_TARGET_MISSING',
                operation,
            });
        }
        try {
            await this.generateContinue();
            const after = this.chat()[beforeLength - 1];
            if (this.chat().length !== beforeLength || !isAssistantMessage(after) || text(after.mes).length <= beforeText.length) {
                throw new FlashControllerError('Continuation did not append to the Anchor response.', {
                    code: 'EMPTY_CONTINUATION',
                    operation,
                });
            }
            if (hasForbiddenProtocol(after)) {
                throw new FlashControllerError('Continuation leaked ST-FLASH protocol markup.', {
                    code: 'FORBIDDEN_PROTOCOL_OUTPUT',
                    operation,
                });
            }
            if (requireStates && !hasCompleteInternalStates(after)) {
                throw new FlashControllerError('Continuation has no complete Internal States block.', {
                    code: 'INTERNAL_STATES_MISSING',
                    operation,
                });
            }
            if (requireStates && visibleProse({ mes: text(after.mes).slice(beforeText.length) }).length < 20) {
                throw new FlashControllerError('Continuation contains Internal States but no additional prose.', {
                    code: 'CONTINUATION_PROSE_MISSING',
                    operation,
                });
            }
            return after;
        } catch (error) {
            const current = this.chat()[beforeLength - 1];
            if (current === target && text(current.mes) !== beforeText) {
                current.mes = beforeText;
                syncActiveSwipe(current);
                if (typeof this.updateMessageBlock === 'function') {
                    try { this.updateMessageBlock(beforeLength - 1, current); } catch { /* optional UI */ }
                }
                await this.persistChat({ throwOnError: true });
            }
            throw error;
        }
    }

    async generateLandingReplacement({ requireStates = true, operation = 'landing' } = {}) {
        const messages = this.chat();
        const target = messages[messages.length - 1];
        const beforeText = text(target?.mes);
        if (!isAssistantMessage(target)) {
            throw new FlashControllerError('There is no final Flash response to replace during Landing.', {
                code: 'LANDING_TARGET_MISSING',
                operation,
            });
        }

        await this.generateContinuation({ requireStates, operation });
        const combined = text(target.mes);
        const landingText = combined.slice(beforeText.length).trim();
        if (!landingText) {
            throw new FlashControllerError('Landing continuation produced no replacement text.', {
                code: 'EMPTY_ASSISTANT_RESPONSE',
                operation,
            });
        }

        target.mes = landingText;
        syncActiveSwipe(target);
        if (typeof this.updateMessageBlock === 'function') {
            try { this.updateMessageBlock(messages.length - 1, target); } catch { /* optional UI */ }
        }
        return target;
    }

    async finishOrdinaryPhase() {
        const session = this.readSession();
        const failedArchiveIds = this.archiveMessageIds(session.failedMessageIds || [], session.sessionId);
        const archiveIds = uniqueIds([...(session.archivedMessageIds || []), ...failedArchiveIds]);
        const failed = session.failedMessageIds || [];
        const releasable = (session.ownedIgnoreMessageIds || []).filter((id) => !failed.some((candidate) => idsEqual(candidate, id)));
        this.unmarkIgnored(releasable);
        this.clearInjections();
        await this.summaryception?.restore?.(session.previousSummaryception, { persist: true });
        this.restoreHostAutomation(session.previousAutomation);
        if (session.previousRole) await this.roleSwitcher.restore(session.previousRole);
        this.transition(PHASES.IDLE, {
            entry: null,
            handoffMessageId: null,
            anchorMessageId: null,
            pendingUserText: null,
            continuationMode: null,
            initialUserMessageId: null,
            continuationUserMessageId: null,
            capsule: null,
            flashTurn: 0,
            flashMessageIds: [],
            ignoredMessageIds: [],
            ownedIgnoreMessageIds: [],
            failedMessageIds: [],
            deltas: [],
            previousRole: null,
            previousSummaryception: null,
            previousAutomation: null,
            archivedMessageIds: archiveIds,
            error: null,
        }, { strict: true });
        await this.persistMetadata({ immediate: true, throwOnError: true });
        await this.persistChat({ throwOnError: true });
        await this.clearUi();
    }

    async abort() {
        // Stop an in-flight provider request immediately; cleanup itself is
        // serialized behind the phase operation to avoid racing chat writes.
        try { this.stopGeneration?.(); } catch { /* optional host API */ }
        return this.mutex.run(async () => {
            const session = this.readSession();
            this.activeGeneration = null;
            try {
                this.clearInjections();
                this.unmarkIgnored(session.ownedIgnoreMessageIds || []);
                await this.summaryception?.restore?.(session.previousSummaryception, { persist: true });
                this.restoreHostAutomation(session.previousAutomation);
                if (session.previousRole) await this.roleSwitcher.restore(session.previousRole);
                this.transition(PHASES.IDLE, {
                    entry: null,
                    handoffMessageId: null,
                    anchorMessageId: null,
                    capsule: null,
                    pendingUserText: null,
                    continuationMode: null,
                    initialUserMessageId: null,
                    continuationUserMessageId: null,
                    ignoredMessageIds: [],
                    ownedIgnoreMessageIds: [],
                    failedMessageIds: [],
                    deltas: [],
                    flashTurn: 0,
                    flashMessageIds: [],
                    previousRole: null,
                    previousSummaryception: null,
                    previousAutomation: null,
                    error: null,
                }, { strict: false });
                await this.persistMetadata({ immediate: true, throwOnError: true });
                await this.persistChat({ throwOnError: true });
                await this.clearUi();
            } catch (error) {
                await this.enterRecovery(error, 'abort');
            }
            return this.readSession();
        });
    }

    async retryRecovery() {
        // This callback is only offered while no generation is running. Do
        // not take the mutex here: capsule retry delegates to acceptFlash(),
        // which takes the mutex itself.
        const session = this.readSession();
        if (session.phase !== PHASES.RECOVERY) return session;
        const operation = session.error?.operation;
        if (operation === 'landing') return this.mutex.run(async () => this.landInternal());
        if (operation === 'capsule') {
            return this.acceptFlash(session.pendingUserText);
        }
        if (operation === 'flash-entry' || operation === 'flash-reply') {
            return this.mutex.run(async () => {
                let nextOperation = operation;
                try {
                    await this.summaryception?.disableForFlash?.();
                    this.disableHostAutomation();
                    this.inject(INJECTION_KEYS.CAPSULE, this.flashCapsuleInjection(session.capsule || ''));
                    this.inject(INJECTION_KEYS.DELTAS, this.deltaInjection(session.deltas));
                    this.inject(INJECTION_KEYS.CONTROL, this.flashControlInjection());
                    await this.roleSwitcher.switchTo('flash');
                    const salvaged = operation === 'flash-reply' ? this.salvageFailedMissingDelta(session) : null;
                    this.transition(PHASES.FLASH, { error: null });
                    await this.persistMetadata({ immediate: true, throwOnError: true });
                    if (salvaged) await this.persistChat({ throwOnError: true });
                    if (operation === 'flash-entry' && session.pendingUserText) {
                        let insertedId = this.findRecentUserMessageId(session.pendingUserText, this.readSession());
                        if (!insertedId) {
                            const inserted = await this.sendMessageAsUser(session.pendingUserText);
                            const insertedIndex = this.chat().indexOf(inserted);
                            insertedId = insertedIndex >= 0 ? ensureMessageId(inserted, insertedIndex) : this.findRecentUserMessageId(session.pendingUserText, this.readSession());
                        }
                        this.updateSession({ pendingUserText: null, initialUserMessageId: insertedId });
                        await this.persistMetadata({ immediate: true, throwOnError: true });
                        await this.persistChat({ throwOnError: true });
                        nextOperation = 'flash-reply';
                        await this.generateNewAssistant({ operation: 'flash-reply' });
                    } else if (operation === 'flash-reply' && !salvaged) {
                        await this.generateNewAssistant({ operation: 'flash-reply' });
                    }
                    this.callUi('showFlashStatus', { session: this.readSession(), onLand: () => this.land(), onAbort: () => this.abort() });
                } catch (error) {
                    await this.enterRecovery(error, nextOperation);
                }
                return this.readSession();
            });
        }
        if (operation === 'continuation-user-insert' || operation === 'continuation-user' || operation === 'continuation-append') {
            return this.mutex.run(async () => {
                const userMode = operation !== 'continuation-append';
                this.transition(PHASES.CONTINUING, {
                    continuationMode: userMode ? 'USER_REPLY' : 'APPEND',
                    error: null,
                });
                await this.persistMetadata({ immediate: true, throwOnError: true });
                let nextOperation = operation;
                try {
                    if (operation === 'continuation-user-insert') {
                        const pendingText = session.pendingUserText || '';
                        let insertedId = this.findRecentUserMessageId(pendingText, this.readSession());
                        if (!insertedId) {
                            const inserted = await this.sendMessageAsUser(pendingText);
                            const insertedIndex = this.chat().indexOf(inserted);
                            insertedId = insertedIndex >= 0 ? ensureMessageId(inserted, insertedIndex) : this.findRecentUserMessageId(pendingText, this.readSession());
                        }
                        this.updateSession({ continuationUserMessageId: insertedId });
                        await this.persistMetadata({ immediate: true, throwOnError: true });
                        await this.persistChat({ throwOnError: true });
                        nextOperation = 'continuation-user';
                    }
                    if (userMode) {
                        this.inject(INJECTION_KEYS.CONTROL, [
                            'DECLINE WITH USER TEXT: answer the newest user message as a complete ordinary roleplay response.',
                            'Do not append to or repeat the interrupted Anchor message.',
                        ].join('\n'));
                        await this.roleSwitcher.switchTo('continuation');
                        await this.generateNewAssistant({ requireStates: true, operation: 'continuation-user' });
                    } else {
                        this.inject(INJECTION_KEYS.CONTROL, [
                            'CONTINUATION MODE: APPEND.',
                            'Continue the existing Anchor assistant message in the same message bubble.',
                        ].join('\n'));
                        await this.roleSwitcher.switchTo('continuation');
                        await this.generateContinuation({ requireStates: true, operation: 'continuation-append' });
                    }
                    await this.finishOrdinaryPhase();
                } catch (error) {
                    await this.enterRecovery(error, nextOperation);
                }
                return this.readSession();
            });
        }
        return session;
    }

    async enterRecovery(error, operation) {
        const info = errorInfo(error, operation);
        const session = this.readSession();
        this.activeGeneration = null;
        try {
            this.clearInjections();
            // Keep the pre-handoff range ignored while a Flash session is
            // recoverable. This prevents a failed retry from silently changing
            // the local-frame prompt.
            const recoveryIgnoreIds = uniqueIds([...(session.ignoredMessageIds || []), ...(session.failedMessageIds || [])]);
            if (recoveryIgnoreIds.length) this.markIgnored(recoveryIgnoreIds);
            await this.summaryception?.restore?.(session.previousSummaryception, { persist: true });
            this.restoreHostAutomation(session.previousAutomation);
            if (session.previousRole) await this.roleSwitcher.restore(session.previousRole);
        } catch (cleanupError) {
            info.cleanup = errorInfo(cleanupError, 'cleanup');
        }
        try {
            this.transition(PHASES.RECOVERY, { error: info }, { strict: false });
        } catch {
            writeSession(this.metadata(), { ...createEmptySession(), phase: PHASES.RECOVERY, error: info });
        }
        await this.persistMetadata({ immediate: true });
        await this.persistChat();
        this.callUi('showRecovery', info);
        this.logger.error?.('[ST-FLASH] recovery', info);
        return info;
    }
}

export function createFlashController(dependencies = {}) {
    return new FlashController(dependencies);
}

export default FlashController;

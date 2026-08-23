/**
 * Per-chat ST-FLASH session metadata.
 *
 * The chat transcript remains the source of evidence. This store contains
 * only orchestration bookkeeping and opaque protocol records. It is written
 * against a supplied chatMetadata object so it can be unit-tested without
 * importing SillyTavern globals.
 */

export const METADATA_KEY = 'st_flash';
export const SCHEMA_VERSION = 1;

export const PHASES = Object.freeze({
  IDLE: 'IDLE',
  OFFERED: 'OFFERED',
  CAPSULING: 'CAPSULING',
  FLASH: 'FLASH',
  LANDING: 'LANDING',
  CONTINUING: 'CONTINUING',
  RECOVERY: 'RECOVERY',
});

const PHASE_SET = new Set(Object.values(PHASES));

const ALLOWED_TRANSITIONS = Object.freeze({
  IDLE: new Set(['OFFERED', 'CAPSULING', 'CONTINUING', 'RECOVERY']),
  OFFERED: new Set(['CAPSULING', 'CONTINUING', 'IDLE', 'RECOVERY']),
  CAPSULING: new Set(['FLASH', 'RECOVERY', 'IDLE']),
  FLASH: new Set(['FLASH', 'LANDING', 'RECOVERY', 'IDLE']),
  LANDING: new Set(['IDLE', 'RECOVERY']),
  CONTINUING: new Set(['IDLE', 'RECOVERY']),
  RECOVERY: new Set(Object.values(PHASES)),
});

function now() {
  return new Date().toISOString();
}

function fallbackId() {
  return `stf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createSessionId() {
  // `crypto.randomUUID` exists in modern browsers and recent Node versions.
  // Keep a fallback for older SillyTavern/WebView environments.
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // Fall through to the non-cryptographic ID. This is not a security token.
  }
  return fallbackId();
}

export function createEmptySession(overrides = {}) {
  const phase = overrides.phase ?? PHASES.IDLE;
  assertPhase(phase);
  return {
    // Preserve forward-compatible fields, but canonical fields below always
    // win over malformed/old values supplied by metadata.
    ...overrides,
    schemaVersion: SCHEMA_VERSION,
    sessionId: overrides.sessionId ?? null,
    phase,
    entry: overrides.entry ?? null,
    handoffMessageId: overrides.handoffMessageId ?? null,
    anchorMessageId: overrides.anchorMessageId ?? null,
    pendingUserText: overrides.pendingUserText ?? null,
    continuationMode: overrides.continuationMode ?? null,
    initialUserMessageId: overrides.initialUserMessageId ?? null,
    continuationUserMessageId: overrides.continuationUserMessageId ?? null,
    capsule: overrides.capsule ?? null,
    flashTurn: Number.isInteger(overrides.flashTurn) ? overrides.flashTurn : 0,
    flashMessageIds: Array.isArray(overrides.flashMessageIds) ? [...overrides.flashMessageIds] : [],
    ignoredMessageIds: Array.isArray(overrides.ignoredMessageIds) ? [...overrides.ignoredMessageIds] : [],
    ownedIgnoreMessageIds: Array.isArray(overrides.ownedIgnoreMessageIds) ? [...overrides.ownedIgnoreMessageIds] : [],
    failedMessageIds: Array.isArray(overrides.failedMessageIds) ? [...overrides.failedMessageIds] : [],
    deltas: Array.isArray(overrides.deltas) ? [...overrides.deltas] : [],
    previousRole: overrides.previousRole ?? null,
    previousSummaryception: overrides.previousSummaryception ?? null,
    previousAutomation: overrides.previousAutomation ?? null,
    error: overrides.error ?? null,
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  };
}

export function assertPhase(phase) {
  if (!PHASE_SET.has(phase)) {
    throw new TypeError(`Unknown ST-FLASH phase: ${String(phase)}`);
  }
  return phase;
}

function cloneSession(session) {
  // Metadata is deliberately JSON-shaped. structuredClone is not guaranteed
  // in the embedded browser, and JSON cloning protects callers from mutating
  // the stored object accidentally.
  return JSON.parse(JSON.stringify(session));
}

function normalizeStored(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createEmptySession();
  let phase = value.phase ?? PHASES.IDLE;
  if (!PHASE_SET.has(phase)) phase = PHASES.RECOVERY;
  return createEmptySession({ ...value, phase });
}

/** Read a copy of the current chat's ST-FLASH session. */
export function readSession(chatMetadata = {}) {
  return cloneSession(normalizeStored(chatMetadata?.[METADATA_KEY]));
}

/** Write a complete session into chat metadata and return a defensive copy. */
export function writeSession(chatMetadata, session) {
  if (!chatMetadata || typeof chatMetadata !== 'object') {
    throw new TypeError('chatMetadata must be an object');
  }
  const normalized = normalizeStored(session);
  normalized.updatedAt = now();
  chatMetadata[METADATA_KEY] = normalized;
  return cloneSession(normalized);
}

/** Remove the stored session and return a fresh IDLE value. */
export function clearSession(chatMetadata) {
  if (chatMetadata && typeof chatMetadata === 'object') delete chatMetadata[METADATA_KEY];
  return createEmptySession();
}

/** Merge a patch into the session without changing the phase implicitly. */
export function updateSession(chatMetadata, patchOrUpdater) {
  const current = readSession(chatMetadata);
  const patch = typeof patchOrUpdater === 'function'
    ? patchOrUpdater(cloneSession(current))
    : patchOrUpdater;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('Session update must return an object patch');
  }
  return writeSession(chatMetadata, { ...current, ...patch });
}

export function startSession(chatMetadata, fields = {}) {
  return writeSession(chatMetadata, createEmptySession({
    ...fields,
    sessionId: fields.sessionId ?? createSessionId(),
    phase: fields.phase ?? PHASES.OFFERED,
  }));
}

export function setPhase(chatMetadata, phase, fields = {}) {
  assertPhase(phase);
  return updateSession(chatMetadata, { ...fields, phase, error: phase === PHASES.RECOVERY ? fields.error : null });
}

/**
 * Change phase with an optional transition check. The check is strict by
 * default so a controller cannot accidentally skip a recovery boundary.
 */
export function transitionSession(chatMetadata, phase, fields = {}, { strict = true } = {}) {
  assertPhase(phase);
  const current = readSession(chatMetadata);
  if (strict && current.phase !== phase && !ALLOWED_TRANSITIONS[current.phase]?.has(phase)) {
    throw new Error(`Invalid ST-FLASH transition ${current.phase} -> ${phase}`);
  }
  return writeSession(chatMetadata, {
    ...current,
    ...fields,
    phase,
    error: phase === PHASES.RECOVERY ? fields.error ?? current.error : null,
  });
}

/** Record one completed Flash response without interpreting its delta. */
export function recordFlashTurn(chatMetadata, { messageId = null, delta = null } = {}) {
  return updateSession(chatMetadata, (session) => ({
    flashTurn: session.flashTurn + 1,
    flashMessageIds: messageId == null
      ? session.flashMessageIds
      : [...session.flashMessageIds, messageId],
    deltas: delta == null ? session.deltas : [...session.deltas, delta],
  }));
}

export function isActiveSession(sessionOrMetadata) {
  const isMetadata = Boolean(
    sessionOrMetadata
    && typeof sessionOrMetadata === 'object'
    && Object.prototype.hasOwnProperty.call(sessionOrMetadata, METADATA_KEY),
  );
  const session = isMetadata ? readSession(sessionOrMetadata) : sessionOrMetadata;
  return Boolean(session && PHASE_SET.has(session.phase) && session.phase !== PHASES.IDLE);
}

export function allowedTransitions(fromPhase) {
  assertPhase(fromPhase);
  return [...ALLOWED_TRANSITIONS[fromPhase]];
}

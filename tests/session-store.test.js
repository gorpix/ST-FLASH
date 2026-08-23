import test from 'node:test';
import assert from 'node:assert/strict';

import {
  METADATA_KEY,
  PHASES,
  allowedTransitions,
  clearSession,
  createEmptySession,
  isActiveSession,
  readSession,
  recordFlashTurn,
  setPhase,
  startSession,
  transitionSession,
  updateSession,
  writeSession,
} from '../src/session-store.js';

test('readSession returns a fresh IDLE value without mutating metadata', () => {
  const metadata = {};
  const session = readSession(metadata);
  assert.equal(session.phase, PHASES.IDLE);
  assert.equal(metadata[METADATA_KEY], undefined);
  session.phase = PHASES.FLASH;
  assert.equal(readSession(metadata).phase, PHASES.IDLE);
});

test('startSession writes a per-chat OFFERED session with a generated ID', () => {
  const metadata = {};
  const session = startSession(metadata, { entry: 'AUTO', handoffMessageId: 12 });
  assert.equal(session.phase, PHASES.OFFERED);
  assert.equal(session.entry, 'AUTO');
  assert.equal(session.handoffMessageId, 12);
  assert.equal(typeof session.sessionId, 'string');
  assert.equal(readSession(metadata).sessionId, session.sessionId);
});

test('writeSession normalizes unknown phases to RECOVERY', () => {
  const metadata = {};
  const session = writeSession(metadata, { phase: 'BROKEN', capsule: 'x' });
  assert.equal(session.phase, PHASES.RECOVERY);
  assert.equal(session.capsule, 'x');
});

test('updateSession supports a patch or updater and keeps values isolated', () => {
  const metadata = {};
  startSession(metadata, { pendingUserText: 'hello' });
  const updated = updateSession(metadata, (current) => ({
    pendingUserText: `${current.pendingUserText} world`,
    flashMessageIds: ['m1'],
  }));
  assert.equal(updated.pendingUserText, 'hello world');
  updated.flashMessageIds.push('mutated-copy');
  assert.deepEqual(readSession(metadata).flashMessageIds, ['m1']);
});

test('strict transitions enforce the v0.1 lifecycle', () => {
  const metadata = {};
  startSession(metadata);
  transitionSession(metadata, PHASES.CAPSULING);
  transitionSession(metadata, PHASES.FLASH);
  transitionSession(metadata, PHASES.LANDING);
  transitionSession(metadata, PHASES.IDLE);
  assert.equal(readSession(metadata).phase, PHASES.IDLE);
  assert.throws(() => transitionSession(metadata, PHASES.FLASH), /Invalid ST-FLASH transition/);
});

test('recovery permits retrying any active phase', () => {
  const metadata = {};
  startSession(metadata);
  transitionSession(metadata, PHASES.RECOVERY, { error: { code: 'TIMEOUT' } });
  assert.equal(readSession(metadata).error.code, 'TIMEOUT');
  transitionSession(metadata, PHASES.CAPSULING);
  assert.equal(readSession(metadata).phase, PHASES.CAPSULING);
  assert.equal(readSession(metadata).error, null);
  assert.ok(allowedTransitions(PHASES.RECOVERY).includes(PHASES.LANDING));
});

test('recordFlashTurn increments only orchestration counters and stores delta opaquely', () => {
  const metadata = {};
  startSession(metadata);
  transitionSession(metadata, PHASES.CAPSULING);
  transitionSession(metadata, PHASES.FLASH);
  const opaque = { raw: '<flash_delta>TIME: ~3</flash_delta>', body: 'TIME: ~3' };
  const session = recordFlashTurn(metadata, { messageId: 4, delta: opaque });
  assert.equal(session.flashTurn, 1);
  assert.deepEqual(session.flashMessageIds, [4]);
  assert.deepEqual(session.deltas, [opaque]);
});

test('isActiveSession handles both metadata and a session value', () => {
  const metadata = {};
  assert.equal(isActiveSession(metadata), false);
  const session = startSession(metadata);
  assert.equal(isActiveSession(metadata), true);
  assert.equal(isActiveSession(session), true);
  setPhase(metadata, PHASES.IDLE);
  assert.equal(isActiveSession(metadata), false);
});

test('clearSession removes only ST-FLASH metadata', () => {
  const metadata = { unrelated: 1 };
  startSession(metadata);
  clearSession(metadata);
  assert.equal(metadata[METADATA_KEY], undefined);
  assert.equal(metadata.unrelated, 1);
  assert.equal(createEmptySession().phase, PHASES.IDLE);
});

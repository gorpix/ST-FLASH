import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStoredIgnoreIds,
  filterIgnoredMessages,
  isMessageIgnored,
  markMessagesIgnored,
  messageIdOf,
  restoreIgnoredMessages,
  selectMessageIds,
  snapshotIgnoredMessages,
} from '../src/context-filter.js';

const IGNORE = Symbol('ignore');

function messages() {
  return [
    { id: 'a', mes: 'old A' },
    { id: 'b', mes: 'old B', extra: { [IGNORE]: 'pre-existing' } },
    { id: 'c', mes: 'new C' },
  ];
}

test('markMessagesIgnored uses the supplied symbol and reports unmatched IDs', () => {
  const chat = messages();
  const result = markMessagesIgnored(chat, ['a', 'c', 'missing'], IGNORE);
  assert.deepEqual(result.matchedIds, ['a', 'c']);
  assert.deepEqual(result.missingIds, ['missing']);
  assert.equal(isMessageIgnored(chat[0], IGNORE), true);
  assert.equal(isMessageIgnored(chat[1], IGNORE), true, 'pre-existing ignore flags must remain untouched');
  assert.equal(isMessageIgnored(chat[2], IGNORE), true);
});

test('filterIgnoredMessages does not mutate the input array', () => {
  const chat = messages();
  chat[0].extra = { [IGNORE]: true };
  const filtered = filterIgnoredMessages(chat, IGNORE);
  assert.deepEqual(filtered.map((message) => message.id), ['c']);
  assert.equal(chat.length, 3);
});

test('snapshot and restore preserve prior values and missing extra objects', () => {
  const chat = messages();
  const snapshot = snapshotIgnoredMessages(chat, ['a', 'b', 'c'], IGNORE);
  markMessagesIgnored(chat, ['a', 'b', 'c'], IGNORE);
  assert.equal(isMessageIgnored(chat[0], IGNORE), true);
  assert.equal(isMessageIgnored(chat[1], IGNORE), true);
  assert.equal(isMessageIgnored(chat[2], IGNORE), true);
  restoreIgnoredMessages(snapshot, IGNORE);
  assert.equal(chat[0].extra, undefined);
  assert.equal(chat[1].extra[IGNORE], 'pre-existing');
  assert.equal(chat[2].extra, undefined);
});

test('snapshot and restore preserve unusual pre-existing extra values', () => {
  const chat = [{ id: 'null', extra: null }, { id: 'text', extra: 'legacy' }];
  const snapshot = snapshotIgnoredMessages(chat, ['null', 'text'], IGNORE);
  markMessagesIgnored(chat, ['null', 'text'], IGNORE);
  restoreIgnoredMessages(snapshot, IGNORE);
  assert.equal(chat[0].extra, null);
  assert.equal(chat[1].extra, 'legacy');
});

test('applyStoredIgnoreIds reapplies serialized IDs after reload', () => {
  const chat = [{ messageId: 0 }, { messageId: 1 }, { messageId: 2 }];
  const result = applyStoredIgnoreIds(chat, [0, '2', 99], IGNORE);
  assert.deepEqual(result.matchedIds, [0, 2]);
  assert.deepEqual(result.missingIds, [99]);
  assert.deepEqual(filterIgnoredMessages(chat, IGNORE).map((message) => message.messageId), [1]);
});

test('helpers support index IDs when messages have no explicit ID', () => {
  const chat = [{ mes: 'zero' }, { mes: 'one' }];
  assert.equal(messageIdOf(chat[1], 1), 1);
  markMessagesIgnored(chat, [1], IGNORE);
  assert.equal(filterIgnoredMessages(chat, IGNORE).length, 1);
  assert.equal(filterIgnoredMessages(chat, IGNORE)[0].mes, 'zero');
});

test('custom ID selector and selectMessageIds are independent of SillyTavern', () => {
  const chat = [{ uid: 'x', role: 'user' }, { uid: 'y', role: 'assistant' }];
  const idOf = (message) => message.uid;
  const ids = selectMessageIds(chat, (message) => message.role === 'assistant', idOf);
  assert.deepEqual(ids, ['y']);
  markMessagesIgnored(chat, ids, IGNORE, idOf);
  assert.equal(isMessageIgnored(chat[1], IGNORE), true);
});

test('invalid ignore symbols fail loudly instead of silently mutating messages', () => {
  assert.throws(() => isMessageIgnored({}, 'not-a-symbol'), /ignoreSymbol must be a Symbol/);
  assert.throws(() => markMessagesIgnored([], [], null), /ignoreSymbol must be a Symbol/);
});

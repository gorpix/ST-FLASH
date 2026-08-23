/**
 * Runtime chat-context filtering helpers.
 *
 * SillyTavern's ignore key is a Symbol and therefore cannot be persisted in
 * chat JSON. ST-FLASH persists message IDs and reapplies the key at runtime.
 * These helpers accept the Symbol explicitly and never import SillyTavern.
 */

function assertIgnoreSymbol(ignoreSymbol) {
  if (typeof ignoreSymbol !== 'symbol') {
    throw new TypeError('ignoreSymbol must be a Symbol');
  }
}

function defaultMessageId(message, index) {
  if (message && typeof message === 'object') {
    if (message.id != null) return message.id;
    if (message.messageId != null) return message.messageId;
    if (message.message_id != null) return message.message_id;
  }
  return index;
}

function idsEqual(left, right) {
  return Object.is(left, right) || String(left) === String(right);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function messageIdOf(message, index, idOf = defaultMessageId) {
  return idOf(message, index);
}

export function isMessageIgnored(message, ignoreSymbol) {
  assertIgnoreSymbol(ignoreSymbol);
  return Boolean(message?.extra && message.extra[ignoreSymbol]);
}

/** Return a new array with ignored messages removed; input is not mutated. */
export function filterIgnoredMessages(messages, ignoreSymbol) {
  assertIgnoreSymbol(ignoreSymbol);
  return [...(messages ?? [])].filter((message) => !isMessageIgnored(message, ignoreSymbol));
}

/**
 * Snapshot the exact prior ignore-key state for selected messages. The
 * snapshot can later be passed to restoreIgnoredMessages, including when a
 * message already had a different value or no `extra` object at all.
 */
export function snapshotIgnoredMessages(messages, messageIds, ignoreSymbol, idOf = defaultMessageId) {
  assertIgnoreSymbol(ignoreSymbol);
  const wanted = [...(messageIds ?? [])];
  const entries = [];
  for (let index = 0; index < (messages ?? []).length; index += 1) {
    const message = messages[index];
    const id = messageIdOf(message, index, idOf);
    if (!wanted.some((candidate) => idsEqual(candidate, id))) continue;
    entries.push({
      message,
      id,
      hadExtraProperty: hasOwn(message, 'extra'),
      hadExtra: Boolean(message && typeof message === 'object' && message.extra && typeof message.extra === 'object'),
      hadKey: Boolean(message?.extra && hasOwn(message.extra, ignoreSymbol)),
      extraValue: message.extra,
      value: message?.extra?.[ignoreSymbol],
    });
  }
  return entries;
}

/** Apply the runtime ignore marker to stored message IDs. */
export function markMessagesIgnored(messages, messageIds, ignoreSymbol, idOf = defaultMessageId) {
  assertIgnoreSymbol(ignoreSymbol);
  const wanted = [...(messageIds ?? [])];
  const matchedIds = [];
  const missingIds = [];
  const seen = new Set();

  for (let index = 0; index < (messages ?? []).length; index += 1) {
    const message = messages[index];
    const id = messageIdOf(message, index, idOf);
    const matchIndex = wanted.findIndex((candidate) => idsEqual(candidate, id));
    if (matchIndex < 0 || !message || typeof message !== 'object') continue;
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    message.extra[ignoreSymbol] = true;
    matchedIds.push(id);
    seen.add(matchIndex);
  }

  wanted.forEach((id, index) => {
    if (!seen.has(index)) missingIds.push(id);
  });
  return { matchedIds, missingIds };
}

/** Restore a snapshot returned by snapshotIgnoredMessages. */
export function restoreIgnoredMessages(snapshot, ignoreSymbol) {
  assertIgnoreSymbol(ignoreSymbol);
  for (const entry of snapshot ?? []) {
    const message = entry?.message;
    if (!message || typeof message !== 'object') continue;
    if (!entry.hadExtra) {
      if (message.extra && typeof message.extra === 'object') {
        delete message.extra[ignoreSymbol];
        // Do not leave an empty object behind when the filter created `extra`.
        // If another component added data while the filter was active, keep it.
        if (Reflect.ownKeys(message.extra).length === 0) {
          if (entry.hadExtraProperty) message.extra = entry.extraValue;
          else delete message.extra;
        }
      } else if (entry.hadExtraProperty) {
        // `extra` is normally an object in SillyTavern, but preserve unusual
        // pre-existing values rather than silently replacing them.
        message.extra = entry.extraValue;
      }
      continue;
    }
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    if (entry.hadKey) message.extra[ignoreSymbol] = entry.value;
    else delete message.extra[ignoreSymbol];
  }
}

/**
 * Convenience operation used when a session resumes after reload: mark stored
 * IDs and return both the reversible snapshot and unmatched IDs.
 */
export function applyStoredIgnoreIds(messages, storedMessageIds, ignoreSymbol, idOf = defaultMessageId) {
  const snapshot = snapshotIgnoredMessages(messages, storedMessageIds, ignoreSymbol, idOf);
  const result = markMessagesIgnored(messages, storedMessageIds, ignoreSymbol, idOf);
  return { ...result, snapshot };
}

export function selectMessageIds(messages, predicate, idOf = defaultMessageId) {
  const ids = [];
  for (let index = 0; index < (messages ?? []).length; index += 1) {
    if (predicate(messages[index], index)) ids.push(messageIdOf(messages[index], index, idOf));
  }
  return ids;
}

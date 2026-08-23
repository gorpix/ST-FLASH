/**
 * Small, deliberately boring wire-format helpers for ST-FLASH.
 *
 * These functions only separate protocol wrappers from roleplay prose. They
 * do not interpret capsule fields or apply a flash delta to a state object.
 * The transcript and the landing model remain responsible for reconciliation.
 */

const HANDOFF_PATTERN = /<flash_handoff(?:\s+entry="(AUTO|USER)")?\s*\/>/g;
const CAPSULE_PATTERN = /<flash_capsule(?:\s[^>]*)?>([\s\S]*?)<\/flash_capsule\s*>/g;
const DELTA_PATTERN = /<flash_delta(?:\s[^>]*)?>([\s\S]*?)<\/flash_delta\s*>/g;
const ESCALATE_PATTERN = /<flash_escalate(?:\s+reason="([^"]*)")?\s*\/>/g;

function trimEndOnly(value) {
  return String(value ?? '').replace(/\s+$/u, '');
}

function decodeXmlAttribute(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function makeMatchError(message, extra = {}) {
  return { code: 'PROTOCOL_PARSE_ERROR', message, ...extra };
}

/**
 * Parse an Anchor handoff only when the marker is the final non-whitespace
 * content. A marker in the middle of prose, or an unknown entry value, is not
 * a handoff. The returned visible text excludes only the terminal marker.
 */
export function parseAnchorHandoff(input) {
  const source = String(input ?? '');
  const terminal = /(?:^|\n)(<flash_handoff\s+entry="(AUTO|USER)"\s*\/>)\s*$/u.exec(source);

  if (!terminal) {
    return {
      matched: false,
      visible: source,
      marker: null,
      entry: null,
      errors: [],
    };
  }

  const marker = terminal[1];
  const entry = terminal[2] ?? null;
  const markerStart = terminal.index + (terminal[0].startsWith('\n') ? 1 : 0);
  const visible = trimEndOnly(source.slice(0, markerStart));
  const allMarkers = [...source.matchAll(HANDOFF_PATTERN)];
  if (allMarkers.length !== 1 || /<flash_handoff\b/u.test(visible)) {
    return {
      matched: false,
      visible: source,
      marker: null,
      entry: null,
      errors: [makeMatchError('Anchor response contained more than one handoff marker', {
        code: 'HANDOFF_DUPLICATE',
      })],
    };
  }

  return {
    matched: true,
    visible,
    marker,
    entry,
    markerStart,
    markerEnd: markerStart + marker.length,
    errors: [],
  };
}

/**
 * Extract exactly one capsule wrapper. Capsule contents are returned verbatim
 * (apart from the wrapper itself); no fields are parsed or normalized.
 */
export function parseFlashCapsule(input, { requireOnlyWrapper = false, expectedEntry = null } = {}) {
  const source = String(input ?? '');
  const matches = [...source.matchAll(CAPSULE_PATTERN)];
  const errors = [];

  if (matches.length === 0) {
    errors.push(makeMatchError('No <flash_capsule> wrapper found', { code: 'CAPSULE_MISSING' }));
    return { matched: false, valid: false, capsule: null, raw: null, errors };
  }
  if (matches.length > 1) {
    errors.push(makeMatchError('More than one <flash_capsule> wrapper found', {
      code: 'CAPSULE_DUPLICATE',
      count: matches.length,
    }));
  }

  const match = matches[0];
  const raw = match[0];
  const prefix = source.slice(0, match.index);
  const suffix = source.slice(match.index + raw.length);
  if (requireOnlyWrapper && (prefix.trim() || suffix.trim())) {
    errors.push(makeMatchError('Capsule output contained text outside its wrapper', {
      code: 'CAPSULE_EXTRA_TEXT',
    }));
  }

  const body = match[1];
  if (expectedEntry != null) {
    const entryMatch = /^\s*ENTRY:\s*(AUTO|USER)\s*$/imu.exec(body);
    if (!entryMatch) {
      errors.push(makeMatchError('Capsule has no valid ENTRY field', {
        code: 'CAPSULE_ENTRY_MISSING',
      }));
    } else if (entryMatch[1] !== expectedEntry) {
      errors.push(makeMatchError(`Capsule ENTRY ${entryMatch[1]} does not match expected ${expectedEntry}`, {
        code: 'CAPSULE_ENTRY_MISMATCH',
        actual: entryMatch[1],
        expected: expectedEntry,
      }));
    }
  }

  return {
    matched: true,
    valid: errors.length === 0,
    capsule: body,
    body,
    raw,
    prefix,
    suffix,
    errors,
  };
}

function removeMatches(source, pattern, onMatch) {
  return source.replace(pattern, (...args) => {
    const match = args[0];
    const offset = args[args.length - 2];
    const groups = args.slice(1, -2);
    onMatch({ raw: match, offset, groups });
    return '';
  });
}

/**
 * Parse a Flash response. Delta text is intentionally opaque: the parser
 * returns its exact wrapper/body and never tries to merge categories or
 * decide whether an event is true. At most one delta is accepted as valid;
 * duplicates are reported while the first remains available for diagnostics.
 */
export function parseFlashOutput(input, { requireDelta = false } = {}) {
  const source = String(input ?? '');
  const errors = [];
  const deltas = [];
  const escalations = [];

  let withoutProtocol = removeMatches(source, DELTA_PATTERN, ({ raw, offset, groups }) => {
    deltas.push({ raw, body: groups[0], offset });
  });

  withoutProtocol = removeMatches(withoutProtocol, ESCALATE_PATTERN, ({ raw, offset, groups }) => {
    escalations.push({
      raw,
      reason: groups[0] == null ? null : decodeXmlAttribute(groups[0]),
      offset,
    });
  });

  // A handoff or capsule in a Flash response is always a protocol violation;
  // leave it visible rather than silently swallowing it.
  if (/<flash_(?:handoff|capsule)\b/u.test(withoutProtocol)) {
    errors.push(makeMatchError('Unexpected handoff or capsule wrapper in Flash output', {
      code: 'FLASH_UNEXPECTED_WRAPPER',
    }));
  }
  if (deltas.length > 1) {
    errors.push(makeMatchError('More than one <flash_delta> wrapper found', {
      code: 'FLASH_DUPLICATE_DELTA',
      count: deltas.length,
    }));
  }
  if (requireDelta && deltas.length === 0) {
    errors.push(makeMatchError('Flash output has no <flash_delta> wrapper', {
      code: 'FLASH_DELTA_MISSING',
    }));
  }
  if (escalations.length > 1) {
    errors.push(makeMatchError('More than one <flash_escalate> marker found', {
      code: 'FLASH_DUPLICATE_ESCALATION',
      count: escalations.length,
    }));
  }

  // Preserve malformed protocol text in `visible`, but make the result
  // invalid so the controller can retry or route to recovery instead of
  // silently treating a truncated machine block as prose.
  if (deltas.length === 0 && /<flash_delta\b|<\/flash_delta\s*>/u.test(source)) {
    errors.push(makeMatchError('Malformed <flash_delta> wrapper', {
      code: 'FLASH_MALFORMED_DELTA',
    }));
  }
  if (escalations.length === 0 && /<flash_escalate\b/u.test(source)) {
    errors.push(makeMatchError('Malformed <flash_escalate> marker', {
      code: 'FLASH_MALFORMED_ESCALATION',
    }));
  }

  return {
    visible: trimEndOnly(withoutProtocol),
    delta: deltas[0] ?? null,
    deltas,
    escalation: escalations[0] ?? null,
    escalations,
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Remove all known protocol wrappers from a string without interpreting their
 * contents. Useful for a display-only cleanup pass after a response was
 * stored. Unknown/malformed tags are intentionally left untouched.
 */
export function stripProtocolWrappers(input) {
  let output = String(input ?? '');
  output = output.replace(HANDOFF_PATTERN, '');
  output = output.replace(CAPSULE_PATTERN, '');
  output = output.replace(DELTA_PATTERN, '');
  output = output.replace(ESCALATE_PATTERN, '');
  return trimEndOnly(output);
}

export const protocolPatterns = Object.freeze({
  handoff: HANDOFF_PATTERN,
  capsule: CAPSULE_PATTERN,
  delta: DELTA_PATTERN,
  escalate: ESCALATE_PATTERN,
});

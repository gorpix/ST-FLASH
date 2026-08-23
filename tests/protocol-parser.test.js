import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAnchorHandoff,
  parseFlashCapsule,
  parseFlashOutput,
  stripProtocolWrappers,
} from '../src/protocol-parser.js';

test('parseAnchorHandoff accepts an exact terminal AUTO marker', () => {
  const result = parseAnchorHandoff('Rex leans closer.\n\n<flash_handoff entry="AUTO"/>\n');
  assert.equal(result.matched, true);
  assert.equal(result.entry, 'AUTO');
  assert.equal(result.visible, 'Rex leans closer.');
  assert.equal(result.marker, '<flash_handoff entry="AUTO"/>');
});

test('parseAnchorHandoff rejects a marker without an explicit entry', () => {
  const source = 'Opening beat.\n<flash_handoff/>';
  const result = parseAnchorHandoff(source);
  assert.equal(result.matched, false);
  assert.equal(result.visible, source);
});

test('parseAnchorHandoff rejects a marker in the middle or with an unknown entry', () => {
  assert.equal(parseAnchorHandoff('<flash_handoff entry="AUTO"/>\nMore prose').matched, false);
  assert.equal(parseAnchorHandoff('Prose\n<flash_handoff entry="MAYBE"/>').matched, false);
  assert.equal(parseAnchorHandoff('Prose\n<flash_handoff entry="AUTO"/> trailing').matched, false);
});

test('parseAnchorHandoff rejects duplicate markers even when one is terminal', () => {
  const source = '<flash_handoff entry="USER"/>\nOpening\n<flash_handoff entry="AUTO"/>';
  const result = parseAnchorHandoff(source);
  assert.equal(result.matched, false);
  assert.ok(result.errors.some((error) => error.code === 'HANDOFF_DUPLICATE'));
});

test('parseFlashCapsule extracts one opaque wrapper', () => {
  const body = '\nENTRY: AUTO\nLOCAL FRAME:\n- CENTER: desk\n';
  const source = `noise\n<flash_capsule version="1">${body}</flash_capsule>\n`;
  const result = parseFlashCapsule(source);
  assert.equal(result.matched, true);
  assert.equal(result.valid, true);
  assert.equal(result.body, body);
  assert.equal(result.capsule, body);
  assert.match(result.raw, /^<flash_capsule version="1">/u);
});

test('parseFlashCapsule reports missing, duplicate, and extra text in strict mode', () => {
  assert.equal(parseFlashCapsule('no capsule').valid, false);
  const duplicate = parseFlashCapsule('<flash_capsule>a</flash_capsule><flash_capsule>b</flash_capsule>');
  assert.equal(duplicate.matched, true);
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.errors.some((error) => error.code === 'CAPSULE_DUPLICATE'));

  const extra = parseFlashCapsule('prefix<flash_capsule>a</flash_capsule>', { requireOnlyWrapper: true });
  assert.equal(extra.valid, false);
  assert.ok(extra.errors.some((error) => error.code === 'CAPSULE_EXTRA_TEXT'));
});

test('parseFlashCapsule can validate an expected ENTRY without changing opaque body text', () => {
  const result = parseFlashCapsule('<flash_capsule>\nENTRY: USER\nLOCAL FRAME: x\n</flash_capsule>', {
    expectedEntry: 'AUTO',
  });
  assert.equal(result.body, '\nENTRY: USER\nLOCAL FRAME: x\n');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'CAPSULE_ENTRY_MISMATCH'));
});

test('parseFlashCapsule accepts harmless tag and ENTRY capitalization changes', () => {
  const result = parseFlashCapsule('<FLASH_CAPSULE>\nENTRY: auto\nLOCAL FRAME:\n- CENTER: desk\n</FLASH_CAPSULE>', {
    expectedEntry: 'AUTO',
  });
  assert.equal(result.valid, true);
  assert.match(result.body, /ENTRY: auto/u);
});

test('parseFlashOutput removes wrappers and preserves an opaque delta', () => {
  const delta = '<flash_delta>TIME: ~4 seconds\nPOSITION: Rex sits down</flash_delta>';
  const source = `Rex sits down.\n\n${delta}\n<flash_escalate reason="time &amp; place"/>\n`;
  const result = parseFlashOutput(source);
  assert.equal(result.valid, true);
  assert.equal(result.visible, 'Rex sits down.');
  assert.equal(result.delta.body, 'TIME: ~4 seconds\nPOSITION: Rex sits down');
  assert.equal(result.delta.raw, delta);
  assert.equal(result.escalation.reason, 'time & place');
  assert.equal(result.escalation.raw, '<flash_escalate reason="time &amp; place"/>');
});

test('parseFlashOutput allows a response with no delta or escalation', () => {
  const result = parseFlashOutput('"Yeah, okay."');
  assert.equal(result.valid, true);
  assert.equal(result.visible, '"Yeah, okay."');
  assert.equal(result.delta, null);
  assert.equal(result.escalation, null);
});

test('parseFlashOutput can require exactly one delta for controller use', () => {
  const result = parseFlashOutput('"Yeah, okay."', { requireDelta: true });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'FLASH_DELTA_MISSING'));
});

test('parseFlashOutput reports duplicate deltas without interpreting either one', () => {
  const result = parseFlashOutput(
    'Visible\n<flash_delta>A: one</flash_delta>\n<flash_delta>B: two</flash_delta>',
  );
  assert.equal(result.valid, false);
  assert.equal(result.deltas.length, 2);
  assert.equal(result.deltas[0].body, 'A: one');
  assert.equal(result.deltas[1].body, 'B: two');
  assert.ok(result.errors.some((error) => error.code === 'FLASH_DUPLICATE_DELTA'));
});

test('parseFlashOutput leaves malformed protocol markup visible', () => {
  const result = parseFlashOutput('Visible\n<flash_delta>unterminated');
  assert.equal(result.visible, 'Visible\n<flash_delta>unterminated');
  assert.equal(result.delta, null);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'FLASH_MALFORMED_DELTA'));
});

test('stripProtocolWrappers is display-only and leaves ordinary text intact', () => {
  const source = 'Opening\n<flash_handoff entry="AUTO"/>\n<flash_delta>x</flash_delta>\n<flash_escalate/>\n';
  assert.equal(stripProtocolWrappers(source), 'Opening');
  assert.equal(stripProtocolWrappers('A <flash_delta>bad'), 'A <flash_delta>bad');
});

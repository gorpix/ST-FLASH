import test from 'node:test';
import assert from 'node:assert/strict';

import { flashStatusPresentation, formatGenerationDuration } from '../src/ui.js';

test('Capsuling status shows an indeterminate progress state and hides Flash-only controls', () => {
  const status = flashStatusPresentation({ phase: 'CAPSULING' });
  assert.equal(status.label, 'Generating capsule');
  assert.equal(status.showProgress, true);
  assert.equal(status.showTurn, false);
  assert.equal(status.canLand, false);
});

test('Flash status restores turn and Landing controls without the Capsule progress bar', () => {
  const status = flashStatusPresentation({ session: { phase: 'FLASH' }, canLand: true });
  assert.equal(status.label, 'Active Flash');
  assert.equal(status.showProgress, false);
  assert.equal(status.showTurn, true);
  assert.equal(status.canLand, true);
});

test('Capsule timer formats tenths of seconds and longer durations compactly', () => {
  assert.equal(formatGenerationDuration(0), '0.0s');
  assert.equal(formatGenerationDuration(12_340), '12.3s');
  assert.equal(formatGenerationDuration(65_240), '1:05.2');
});

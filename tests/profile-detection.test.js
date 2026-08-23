import assert from 'node:assert/strict';
import test from 'node:test';

import { detectRoleProfiles } from '../src/profile-detection.js';

const available = [
  { id: 'a', name: 'ST-Flash A (Kimi k3-256k(max))', model: 'kimi-k3-256k(max)' },
  { id: 'b', name: 'ST-Flash B (Kimi k2.7-code-highspeed)', model: 'kimi-k2.7-code-highspeed' },
  { id: 'c', name: 'ST-Flash C (Kimi k3-256k(low))', model: 'kimi-k3-256k(low)' },
];

test('detects the existing ST-FLASH A/B/C profiles', () => {
  assert.deepEqual(detectRoleProfiles({}, available), {
    profiles: { anchor: 'a', flash: 'b', landing: 'c' },
    changed: true,
  });
});

test('never overwrites an explicit profile choice', () => {
  const result = detectRoleProfiles({ anchor: 'custom-a' }, available);
  assert.equal(result.profiles.anchor, 'custom-a');
  assert.equal(result.profiles.flash, 'b');
  assert.equal(result.profiles.landing, 'c');
});

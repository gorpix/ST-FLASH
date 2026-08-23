import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { preparePresetSet } from '../tools/prepare-presets.mjs';

const PROJECT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function promptEnabled(preset, identifier) {
  return (preset.prompt_order || []).some((group) => (
    (group.order || []).some((item) => item.identifier === identifier && item.enabled === true)
  ));
}

function preset(prompts, enabled = prompts.map((item) => item.identifier)) {
  return {
    prompts,
    prompt_order: [{ character_id: 100001, order: prompts.map((item) => ({
      identifier: item.identifier,
      enabled: enabled.includes(item.identifier),
    })) }],
  };
}

test('preparePresetSet updates control prompts and removes per-session capsule payloads', () => {
  const input = {
    capsule: preset([{ identifier: 'main', name: 'Main Prompt', content: 'old' }, { identifier: 'nsfw', name: 'Capsule', content: 'private scene' }]),
    anchor: preset([{ identifier: 'router', name: 'FLASH Router', content: 'old router' }]),
    flash: preset([{ identifier: 'main', name: 'Main Prompt', content: 'old flash rules' }, { identifier: 'nsfw', name: 'Capsule', content: '<flash_capsule>old</flash_capsule>' }]),
    landing: preset([{ identifier: 'landing', name: 'Landing Reconciler', content: 'old landing' }, { identifier: 'handoff', name: 'Handoff Capsule', content: '<flash_capsule>old</flash_capsule>' }]),
    continuation: preset([{ identifier: 'continue', name: 'Continuation', content: 'continue' }, { identifier: 'handoff', name: 'Handoff Capsule', content: '<flash_capsule>old</flash_capsule>' }]),
  };

  const result = preparePresetSet(input, {
    capsule: 'new capsule',
    anchor: 'new router',
    flash: 'new flash rules',
    landing: 'new landing',
    continuation: 'new continuation',
  });

  assert.equal(result.capsule.prompts[0].content, 'new capsule');
  assert.equal(result.anchor.prompts[0].content, 'new router');
  assert.equal(result.flash.prompts[0].content, 'new flash rules');
  assert.equal(result.landing.prompts[0].content, 'new landing');
  assert.equal(result.continuation.prompts[0].content, 'new continuation');
  assert.equal(result.flash.prompts[1].content, '');
  assert.equal(result.landing.prompts[1].content, '');
  assert.equal(result.continuation.prompts[1].content, '');
  assert.equal(result.flash.prompt_order[0].order[1].enabled, false);
  assert.equal(input.flash.prompts[1].content, '<flash_capsule>old</flash_capsule>');
});

test('prepared output is exactly the five installable ST-FLASH presets', () => {
  const directory = path.join(PROJECT_DIR, 'presets', 'prepared');
  const expected = [
    'Capsule.json',
    'FF5.2 Anchor.json',
    'FF5.2 Continuation.json',
    'FF5.2 Flash.json',
    'FF5.2 Landing.json',
  ];
  assert.deepEqual(readdirSync(directory).filter((name) => name.endsWith('.json')).sort(), expected);

  const loaded = Object.fromEntries(expected.map((name) => [
    name,
    JSON.parse(readFileSync(path.join(directory, name), 'utf8')),
  ]));
  for (const [name, preset] of Object.entries(loaded)) {
    assert.ok(Array.isArray(preset.prompts), `${name} has prompts`);
    for (const prompt of preset.prompts.filter((item) => /^(?:Capsule|Handoff Capsule)$/i.test(item.name || ''))) {
      assert.equal(String(prompt.content || '').trim(), '', `${name} has no static scene capsule`);
      assert.equal(promptEnabled(preset, prompt.identifier), false, `${name} static capsule is disabled`);
    }
  }

  const landing = loaded['FF5.2 Landing.json'];
  const continuation = loaded['FF5.2 Continuation.json'];
  const landingPrompt = landing.prompts.find((item) => item.name === 'Landing Reconciler');
  const continuationPrompt = continuation.prompts.find((item) => item.name === 'Continuation');
  assert.equal(promptEnabled(landing, landingPrompt.identifier), true);
  assert.equal(promptEnabled(continuation, continuationPrompt.identifier), true);
  assert.equal(continuation.prompts.some((item) => item.name === 'Landing Reconciler' && promptEnabled(continuation, item.identifier)), false);
});

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.dirname(SCRIPT_DIR);

const FILES = Object.freeze({
  capsule: 'Capsule.json',
  anchor: 'FF5.2 Anchor.json',
  flash: 'FF5.2 Flash.json',
  landing: 'FF5.2 Landing.json',
  continuation: 'FF5.2 Continuation.json',
});

const PROMPT_SOURCES = Object.freeze({
  capsule: path.join(PROJECT_DIR, 'flash-prompt', 'capsule', 'capsule-generator-v1.0-local-frame.txt'),
  anchor: path.join(PROJECT_DIR, 'flash-prompt', 'anchor', 'anchor-flash-router-v0.4.txt'),
  flash: path.join(PROJECT_DIR, 'flash-prompt', 'presets', 'flash-main-v0.7-minimal.txt'),
  landing: path.join(PROJECT_DIR, 'flash-prompt', 'landing', 'landing-reconciler-v0.4-prose.txt'),
  continuation: path.join(PROJECT_DIR, 'flash-prompt', 'continuation', 'decline-continuation-v0.2-dual-mode.txt'),
});

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--source' || argument === '--target') {
      values[argument.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  if (!values.source || !values.target) {
    throw new Error('Usage: node tools/prepare-presets.mjs --source <preset-dir> --target <output-dir>');
  }
  return {
    source: path.resolve(values.source),
    target: path.resolve(values.target),
  };
}

function findPrompt(preset, predicate, description) {
  const prompt = preset.prompts?.find(predicate);
  if (!prompt) throw new Error(`Could not find ${description}`);
  return prompt;
}

function setPromptEnabled(preset, identifier, enabled) {
  for (const order of preset.prompt_order ?? []) {
    for (const item of order.order ?? []) {
      if (item.identifier === identifier) item.enabled = enabled;
    }
  }
}

function clearDynamicCapsulePrompt(preset, predicate, description) {
  const prompt = findPrompt(preset, predicate, description);
  prompt.content = '';
  setPromptEnabled(preset, prompt.identifier, false);
}

export function preparePresetSet(presets, promptText) {
  const output = structuredClone(presets);

  findPrompt(output.capsule, (prompt) => prompt.identifier === 'main', 'Capsule main prompt').content = promptText.capsule;
  findPrompt(output.anchor, (prompt) => prompt.name === 'FLASH Router', 'Anchor FLASH Router').content = promptText.anchor;
  findPrompt(output.flash, (prompt) => prompt.identifier === 'main', 'Flash main prompt').content = promptText.flash;
  findPrompt(output.landing, (prompt) => prompt.name === 'Landing Reconciler', 'Landing Reconciler').content = promptText.landing;
  findPrompt(output.continuation, (prompt) => prompt.name === 'Continuation', 'Continuation').content = promptText.continuation;

  clearDynamicCapsulePrompt(output.capsule, (prompt) => prompt.identifier === 'nsfw', 'Capsule scratch payload');
  clearDynamicCapsulePrompt(output.flash, (prompt) => prompt.identifier === 'nsfw', 'Flash capsule payload');
  clearDynamicCapsulePrompt(output.landing, (prompt) => prompt.name === 'Handoff Capsule', 'Landing handoff capsule');
  clearDynamicCapsulePrompt(output.continuation, (prompt) => prompt.name === 'Handoff Capsule', 'Continuation handoff capsule');

  return output;
}

async function loadPresetSet(directory) {
  return Object.fromEntries(await Promise.all(Object.entries(FILES).map(async ([role, fileName]) => {
    const text = await readFile(path.join(directory, fileName), 'utf8');
    return [role, JSON.parse(text)];
  })));
}

async function loadPromptText() {
  return Object.fromEntries(await Promise.all(Object.entries(PROMPT_SOURCES).map(async ([role, fileName]) => [
    role,
    (await readFile(fileName, 'utf8')).trim(),
  ])));
}

async function main() {
  const locations = parseArguments(process.argv.slice(2));
  const prepared = preparePresetSet(await loadPresetSet(locations.source), await loadPromptText());
  await mkdir(locations.target, { recursive: true });
  for (const [role, fileName] of Object.entries(FILES)) {
    await writeFile(path.join(locations.target, fileName), `${JSON.stringify(prepared[role], null, 4)}\n`, 'utf8');
  }
  process.stdout.write(`Prepared ${Object.keys(FILES).length} ST-FLASH presets in ${locations.target}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

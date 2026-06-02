import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePresetJson } from '../src/presets.js';
import { generateWorldbookPlan, testOpenAICompatibleConnection } from '../src/openai.js';
import {
  buildWorldbookPreviewModel,
  normalizeWorldbookPackage,
  toStandaloneWorldInfo,
  validateWorldbook,
} from '../src/worldbook.js';

test('worldbook package embeds character_book and exports standalone World Info entries', () => {
  const pack = normalizeWorldbookPackage({
    worldbook: {
      name: 'Clockwork City',
      description: 'A city driven by legal machinery.',
      entries: [{
        title: 'Gear Court',
        keys: ['Gear Court', 'clock law'],
        content: 'The Gear Court interprets old machine law.',
        group: 'Factions',
        position: 0,
      }],
    },
  });

  assert.equal(pack.card.spec, 'chara_card_v2');
  assert.equal(pack.card.data.character_book.name, 'Clockwork City');
  assert.equal(pack.card.data.extensions.st_card_writer.kind, 'worldbook-card');
  assert.equal(pack.card.data.character_book.entries[0].keys[0], 'Gear Court');
  assert.equal(pack.worldInfo.entries['0'].key[1], 'clock law');
  assert.equal(validateWorldbook(pack).valid, true);
});

test('standalone World Info JSON contains entries object for SillyTavern import', () => {
  const worldInfo = toStandaloneWorldInfo({
    name: 'Mirror Delta',
    description: 'Wetlands with mirrored ruins.',
    entries: [{
      uid: 5,
      comment: 'Flood Gate',
      key: ['flood gate'],
      content: 'The flood gate opens when the old bell rings.',
      order: 90,
      position: 1,
    }],
  });

  assert.equal(typeof worldInfo.entries, 'object');
  assert.equal(worldInfo.entries['5'].uid, 5);
  assert.deepEqual(worldInfo.entries['5'].key, ['flood gate']);
  assert.equal(worldInfo.entries['5'].position, 1);
});

test('worldbook preview does not mutate card export data', () => {
  const pack = normalizeWorldbookPackage({
    worldbook: {
      name: 'Glass Archive',
      description: 'An archive that records rumors.',
      entries: [{
        title: 'Rumor Index',
        keys: ['rumor index'],
        content: 'Rumors are cataloged by emotional temperature.',
      }],
    },
  });
  const before = JSON.stringify(pack.card);
  const preview = buildWorldbookPreviewModel(pack, { regexTestText: 'hello' });

  assert.equal(JSON.stringify(pack.card), before);
  assert.equal(preview.header.name, 'Glass Archive');
  assert.equal(preview.metrics.entries, 1);
});

test('preset analyzer reports type, validity, field count, and errors', () => {
  const instruct = analyzePresetJson({
    input_sequence: 'User:',
    output_sequence: 'Assistant:',
    system_sequence: 'System:',
  }, 'instruct.json');
  const invalid = analyzePresetJson('{ bad json', 'bad.json');

  assert.equal(instruct.valid, true);
  assert.equal(instruct.recognizedType, 'instruct');
  assert.ok(instruct.keyCount >= 3);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.recognizedType, 'unknown');
  assert.ok(invalid.errors[0].includes('JSON parse failed'));
});

test('connection test succeeds on /models and reports model availability', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ id: 'local-model' }, { id: 'other-model' }] }),
    text: async () => '',
  });

  const result = await testOpenAICompatibleConnection({
    api: { baseUrl: 'http://example.test/v1', apiKey: 'test', model: 'local-model' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, 'GET /models');
  assert.equal(result.modelAvailable, true);
});

test('connection test redacts API-looking secrets from failures', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({}),
    text: async () => 'Authorization failed for Bearer secret-token-for-test',
  });

  const result = await testOpenAICompatibleConnection({
    api: { baseUrl: 'http://example.test/v1', apiKey: 'test', model: 'local-model' },
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /Bearer \*\*\*/);
  assert.doesNotMatch(result.message, /secret-token-for-test/);
});

test('generate worldbook plan parses JSON-only OpenAI-compatible response', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            plan: {
              worldName: 'Ash Rail',
              summary: 'A train line through a ruined province.',
              groups: ['Locations'],
              entries: [{ title: 'Cinder Station', group: 'Locations', purpose: 'Main hub', keys: ['cinder station'] }],
            },
          }),
        },
      }],
    }),
    text: async () => '',
  });

  const result = await generateWorldbookPlan({
    api: { baseUrl: 'http://example.test/v1', apiKey: 'test', model: 'local-model' },
    brief: 'Build a rail worldbook.',
  });

  assert.equal(result.plan.worldName, 'Ash Rail');
  assert.equal(result.plan.entries[0].keys[0], 'cinder station');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePresetJson } from '../src/presets.js';
import { generateWorldbookPlan, refineWorldbookWithOpenAICompatible, testOpenAICompatibleConnection } from '../src/openai.js';
import {
  buildWorldbookPreviewModel,
  importWorldbookJson,
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

test('external SillyTavern World Info JSON imports into editable worldbook package', () => {
  const result = importWorldbookJson({
    fileName: 'outside.worldinfo.json',
    content: JSON.stringify({
      name: 'Outside Book',
      description: 'Imported lore.',
      entries: {
        7: {
          uid: 7,
          key: ['outside gate'],
          keysecondary: ['silver key'],
          comment: 'Outside Gate',
          content: 'The outside gate opens at dawn.',
          order: 70,
          position: 1,
          group: 'Locations',
          disable: false,
        },
      },
    }),
  });

  assert.equal(result.importReport.sourceType, 'sillytavern_world_info');
  assert.equal(result.importReport.entryCount, 1);
  assert.equal(result.worldbook.name, 'Outside Book');
  assert.equal(result.worldbook.entries[0].id, 7);
  assert.deepEqual(result.worldbook.entries[0].keys, ['outside gate']);
  assert.deepEqual(result.worldbook.entries[0].secondaryKeys, ['silver key']);
  assert.equal(result.card.data.character_book.entries.length, 1);
  assert.equal(validateWorldbook(result).valid, true);
});

test('embedded TavernCard character_book imports as a worldbook', () => {
  const result = importWorldbookJson({
    json: {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Carrier',
        description: 'Carrier card.',
        personality: '',
        scenario: '',
        first_mes: 'Ready.',
        mes_example: '',
        alternate_greetings: [],
        tags: ['imported'],
        creator: 'tester',
        character_version: '1.0.0',
        extensions: {},
        character_book: {
          name: 'Embedded Book',
          description: 'Embedded lore.',
          entries: [{
            id: 2,
            keys: ['embedded'],
            comment: 'Embedded Entry',
            content: 'Embedded content.',
            insertion_order: 55,
            enabled: true,
            position: 'before_char',
          }],
        },
      },
    },
  });

  assert.equal(result.importReport.sourceType, 'tavern_card_v2_character_book');
  assert.equal(result.worldbook.name, 'Embedded Book');
  assert.equal(result.worldbook.entries[0].title, 'Embedded Entry');
  assert.equal(result.worldInfo.entries['2'].content, 'Embedded content.');
});

test('story augment import appends external lore without replacing current story material', () => {
  const result = importWorldbookJson({
    mode: 'story-augment',
    fileName: 'outside.worldinfo.json',
    targetWorldbook: {
      name: 'Current Story',
      description: 'Existing story material.',
      entries: [{
        id: 10,
        title: 'Existing Ally',
        keys: ['ally'],
        content: 'The ally refuses to betray old promises.',
        group: 'Cast',
      }],
    },
    content: JSON.stringify({
      name: 'Outside Book',
      entries: {
        3: {
          uid: 3,
          key: ['outside gate'],
          comment: 'Outside Gate',
          content: 'The outside gate opens at dawn.',
          group: 'Locations',
        },
      },
    }),
  });

  assert.equal(result.importReport.mode, 'story-augment');
  assert.equal(result.importReport.previousEntryCount, 1);
  assert.equal(result.importReport.importedEntryCount, 1);
  assert.equal(result.importReport.appendedEntryCount, 1);
  assert.equal(result.worldbook.name, 'Current Story');
  assert.deepEqual(result.worldbook.entries.map((entry) => entry.title), ['Existing Ally', 'Outside Gate']);
  assert.equal(result.worldbook.entries[1].id, 11);
  assert.equal(result.worldbook.entries[1].source.fileName, 'outside.worldinfo.json');
  assert.equal(result.worldbook.entries[1].source.originalId, 3);
  assert.equal(result.card.data.extensions.st_card_writer.story_augment.importedEntryCount, 1);
  assert.equal(result.card.data.extensions.st_card_writer.deep_role.enabled, true);
  assert.equal(result.card.data.character_book.entries[1].extensions.st_card_writer.source.originalId, 3);
  assert.equal(validateWorldbook(result).valid, true);
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

test('AI worldbook refinement parses cleaned worldbook and change summary', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    assert.equal(request.response_format.type, 'json_object');
    assert.match(request.messages[1].content, /Mode: summarize/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              changeSummary: 'Merged duplicate lore and shortened the entry.',
              regexScripts: [],
              worldbook: {
                name: 'Compact Book',
                description: 'Short book.',
                summary: 'Short book.',
                tags: ['worldbook-card'],
                creator: 'tester',
                version: '1.0.0',
                first_mes: '',
                system_prompt: '',
                post_history_instructions: '',
                entries: [{
                  title: 'Compact Gate',
                  keys: ['gate'],
                  secondaryKeys: [],
                  triggerLogic: 'keyword',
                  content: 'A shorter gate entry.',
                  position: 0,
                  priority: 100,
                  group: 'Locations',
                  enabled: true,
                  imageUrl: '',
                  placeholder: 'CG',
                  color: '#58a6ff',
                }],
              },
            }),
          },
        }],
      }),
      text: async () => '',
    };
  };

  const result = await refineWorldbookWithOpenAICompatible({
    api: { baseUrl: 'http://example.test/v1', apiKey: 'test', model: 'local-model' },
    mode: 'summarize',
    instruction: 'Shorten repeated lore.',
    worldbook: {
      name: 'Verbose Book',
      description: 'Long book.',
      entries: [{
        title: 'Verbose Gate',
        keys: ['gate'],
        content: 'Long gate entry. Long gate entry.',
      }],
    },
  });

  assert.equal(result.changeSummary, 'Merged duplicate lore and shortened the entry.');
  assert.equal(result.worldbook.name, 'Compact Book');
  assert.equal(result.worldbook.entries[0].content, 'A shorter gate entry.');
  assert.equal(result.validation.valid, true);
});

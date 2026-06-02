import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyCard, normalizeCard, validateCard } from '../src/card.js';
import { buildPreviewModel } from '../src/render.js';
import { previewRegexScripts, validateRegexScripts } from '../src/regex.js';

test('empty card is valid TavernCard V2 shape with warnings', () => {
  const validation = validateCard(createEmptyCard());
  assert.equal(validation.valid, true);
  assert.equal(validation.card.spec, 'chara_card_v2');
  assert.equal(validation.card.spec_version, '2.0');
  assert.ok(Array.isArray(validation.card.data.alternate_greetings));
  assert.ok(Array.isArray(validation.card.data.tags));
  assert.equal(typeof validation.card.data.extensions, 'object');
  assert.ok(validation.warnings.length >= 1);
});

test('normalizes generated card data and mirrors legacy fields', () => {
  const card = normalizeCard({
    data: {
      name: 'Ari',
      description: 'Clockmaker.',
      personality: 'Patient.',
      scenario: 'Rainy city.',
      first_mes: 'Welcome.',
      mes_example: '<START>',
      creator_notes: 'Notes',
      system_prompt: 'Stay in character.',
      post_history_instructions: 'Continue.',
      alternate_greetings: 'Hello again.',
      tags: 'mystery, calm',
      creator: 'tester',
      character_version: '1.2.3',
      extensions: {},
    },
  });

  assert.equal(card.name, 'Ari');
  assert.equal(card.data.name, 'Ari');
  assert.deepEqual(card.data.tags, ['mystery', 'calm']);
  assert.deepEqual(card.data.alternate_greetings, ['Hello again.']);
  assert.equal(validateCard(card).valid, true);
});

test('regex scripts validate SillyTavern placement and compile', () => {
  const validation = validateRegexScripts([{
    scriptName: 'Trim prefix',
    findRegex: '/^Bot:\\s*/i',
    replaceString: '',
    trimStrings: [],
    placement: [2],
  }]);

  assert.equal(validation.valid, true);
  assert.equal(validation.normalized[0].placement[0], 2);
  assert.equal(typeof validation.normalized[0].id, 'string');
});

test('regex preview follows string replacement behavior', () => {
  const result = previewRegexScripts('Bot: hello', [{
    scriptName: 'Trim prefix',
    findRegex: '/^Bot:\\s*/i',
    replaceString: '',
    trimStrings: [],
    placement: [2],
  }]);

  assert.equal(result.output, 'hello');
  assert.equal(result.steps[0].changed, true);
});

test('render preview does not mutate card export data', () => {
  const card = normalizeCard({
    data: {
      name: 'Ari',
      description: 'Clockmaker.',
      first_mes: 'Welcome.',
      tags: ['tag'],
      extensions: {},
    },
  });
  const before = JSON.stringify(card);
  const preview = buildPreviewModel(card, { regexTestText: 'Bot: hello' });

  assert.equal(JSON.stringify(card), before);
  assert.equal(preview.header.name, 'Ari');
  assert.equal(preview.metrics.greetingCount, 1);
});

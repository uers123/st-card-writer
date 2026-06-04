import test from 'node:test';
import assert from 'node:assert/strict';
import { deletePlanEntry, ensurePlanEntries, normalizePlanKeys, updatePlanEntry } from '../public/modules/plan-editor.js';

test('plan entry edits update the same plan object used for generation', () => {
  const plan = {
    entries: [{
      title: 'Old title',
      group: 'Core',
      keys: ['old'],
      purpose: 'Old purpose',
    }],
  };

  assert.equal(updatePlanEntry(plan, 0, 'title', 'New title'), true);
  assert.equal(updatePlanEntry(plan, 0, 'group', 'Locations'), true);
  assert.equal(updatePlanEntry(plan, 0, 'keys', 'gate, door，archive'), true);
  assert.equal(updatePlanEntry(plan, 0, 'purpose', 'Track gates.'), true);

  assert.deepEqual(plan.entries[0], {
    title: 'New title',
    group: 'Locations',
    keys: ['gate', 'door', 'archive'],
    purpose: 'Track gates.',
  });
});

test('plan entry deletion removes the selected outline entry only', () => {
  const plan = {
    entries: [
      { title: 'Keep' },
      { title: 'Remove' },
      { title: 'Also keep' },
    ],
  };

  assert.equal(deletePlanEntry(plan, 1), true);
  assert.deepEqual(plan.entries.map((entry) => entry.title), ['Keep', 'Also keep']);
  assert.equal(deletePlanEntry(plan, 99), false);
});

test('plan helpers normalize missing entries and mixed keyword separators', () => {
  const plan = {};

  assert.equal(ensurePlanEntries(plan), true);
  assert.deepEqual(plan.entries, []);
  assert.deepEqual(normalizePlanKeys([' one ', '', 'two']), ['one', 'two']);
  assert.deepEqual(normalizePlanKeys('one, two，three'), ['one', 'two', 'three']);
});

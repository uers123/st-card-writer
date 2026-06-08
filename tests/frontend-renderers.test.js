import test from 'node:test';
import assert from 'node:assert/strict';

test('plan outline renders editable fields and delete controls safely', async (t) => {
  let html = '';
  globalThis.document = {
    querySelector(selector) {
      assert.equal(selector, '#planOutline');
      return {
        set innerHTML(value) {
          html = value;
        },
        get innerHTML() {
          return html;
        },
      };
    },
  };
  t.after(() => {
    delete globalThis.document;
  });

  const { renderPlanOutline } = await import('../public/modules/renderers.js');

  renderPlanOutline({
    entries: [{
      title: '<Gate>',
      group: 'Locations',
      keys: ['gate', 'door'],
      purpose: 'Tracks access.',
    }],
  });

  assert.match(html, /data-plan-entry-index="0"/);
  assert.match(html, /data-plan-delete-index="0"/);
  assert.match(html, /data-plan-field="title"/);
  assert.match(html, /data-plan-field="group"/);
  assert.match(html, /data-plan-field="keys"/);
  assert.match(html, /data-plan-field="purpose"/);
  assert.match(html, /gate, door/);
  assert.doesNotMatch(html, /<Gate>/);
  assert.match(html, /&lt;Gate&gt;/);
});

test('render preview shows SillyTavern extension feedback with trigger state', async (t) => {
  let html = '';
  globalThis.document = {
    querySelector(selector) {
      assert.equal(selector, '#renderPreview');
      return {
        set innerHTML(value) {
          html = value;
        },
        get innerHTML() {
          return html;
        },
      };
    },
  };
  t.after(() => {
    delete globalThis.document;
  });

  const { renderPreview } = await import('../public/modules/renderers.js');

  renderPreview({
    header: {
      name: 'Trigger Book',
      subtitle: 'A book imported into SillyTavern.',
      accentColor: '#58a6ff',
    },
    tags: ['worldbook-card'],
    metrics: { entries: 1, groups: 1, estimatedTokens: 12 },
    groups: [{ name: 'Locations', entries: [], enabled: 1 }],
    entries: [{
      id: 1,
      title: '<Gate>',
      group: 'Locations',
      keys: ['gate'],
      secondaryKeys: [],
      content: 'Gate lore.',
      enabled: true,
      color: '#58a6ff',
    }],
    sections: [],
    regexPreview: { output: 'The gate opens.' },
  });

  assert.match(html, /世界书卡视图/);
  assert.match(html, /data\.character_book/);
  assert.match(html, /最近触发/);
  assert.match(html, /已触发/);
  assert.match(html, /出现 1/);
  assert.doesNotMatch(html, /<Gate>/);
  assert.match(html, /&lt;Gate&gt;/);
});

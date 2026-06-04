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

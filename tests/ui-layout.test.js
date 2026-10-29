import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, root), 'utf8');

test('MAE cover exposes the top directory and editable entity workspace', () => {
  const html = read('public/index.html');
  const app = read('public/mae-app.js');
  const css = read('public/mae.css');
  assert.match(html, /id="directoryToggle"/);
  assert.match(html, /id="maeDirectory"/);
  assert.match(html, /id="entityEditorList"/);
  assert.match(html, /data-view="memory"/);
  assert.match(app, /maeFetch\('\/entity'/);
  assert.match(css, /mae-drop-in/);
});

test('SillyTavern card viewer drops from the top and saves visible card entries', () => {
  const source = read('sillytavern-extension/st-card-writer-viewer/index.js');
  const css = read('sillytavern-extension/st-card-writer-viewer/style.css');
  assert.match(source, /saveCharacterDebounced/);
  assert.match(source, /data-stcwv-entry-field/);
  assert.match(source, /data-stcwv-section/);
  assert.match(css, /align-items:\s*start/);
  assert.match(css, /stcwv-drop-in/);
  assert.doesNotMatch(css, /justify-items:\s*end/);
});

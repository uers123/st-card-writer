import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../sillytavern-extension/memory-agency/', import.meta.url);

test('MAE SillyTavern extension manifest and entrypoint are self-contained', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const source = await readFile(new URL('index.js', root), 'utf8');
  assert.equal(manifest.generate_interceptor, 'maeGenerationInterceptor');
  assert.equal(manifest.js, 'index.js');
  assert.match(source, /event_types\.CHAT_CHANGED/);
  assert.match(source, /event_types\.GENERATION_ENDED/);
  assert.match(source, /setExtensionPrompt/);
  assert.match(source, /worldbook\/sync/);
  assert.match(source, /result\.tickDue/);
  assert.match(source, /syncRuntimeSettings/);
  assert.match(source, /autoTick: true/);
  assert.match(source, /gaiden/);
  assert.match(source, /createSuccessorFromPrompt/);
  assert.match(source, /renderPhysiologyText/);
  assert.doesNotMatch(source, /[A-Z]:\\\\/u);
});

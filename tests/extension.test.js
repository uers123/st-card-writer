import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const EXTENSION_DIR = new URL('../sillytavern-extension/st-card-writer-viewer/', import.meta.url);

test('SillyTavern extension manifest wires deep-role generation interceptor', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', EXTENSION_DIR), 'utf8'));
  const index = await readFile(new URL('index.js', EXTENSION_DIR), 'utf8');
  const style = await readFile(new URL('style.css', EXTENSION_DIR), 'utf8');

  assert.equal(manifest.js, 'index.js');
  assert.equal(manifest.css, 'style.css');
  assert.equal(manifest.generate_interceptor, 'stCardWriterDeepRoleInterceptor');
  assert.match(index, /globalThis\[INTERCEPTOR_NAME\]\s*=\s*generationInterceptor/);
  assert.match(index, /setExtensionPrompt\(/);
  assert.match(index, /generateQuietPrompt\(/);
  assert.match(style, /\.stcwv-memory/);
  assert.doesNotMatch(index, /涓|鎵|鍚|绂|脳/);
});

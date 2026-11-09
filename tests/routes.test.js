import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApiRouter } from '../src/routes.js';

test('api router exposes health and worldbook export endpoints', async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(() => server.close());

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthResponse.ok, true);
  assert.equal((await healthResponse.json()).name, 'st-card-writer');
  const compatibilityResponse = await fetch(`${baseUrl}/api/compatibility`);
  assert.equal(compatibilityResponse.ok, true);
  assert.equal((await compatibilityResponse.json()).apiVersion, '1.0.0');

  const localConfigResponse = await fetch(`${baseUrl}/api/local-config`);
  const localConfig = await localConfigResponse.json();
  assert.equal(localConfigResponse.ok, true);
  assert.equal(Object.hasOwn(localConfig, 'apiKey'), false);

  const exportResponse = await fetch(`${baseUrl}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      worldbook: {
        name: 'Route Smoke World',
        description: 'Router integration test worldbook.',
        entries: [{
          title: 'Beacon',
          keys: ['beacon'],
          content: 'The beacon marks the safe road.',
        }],
      },
      regexScripts: [],
    }),
  });
  const exported = await exportResponse.json();

  assert.equal(exportResponse.ok, true);
  assert.equal(exported.cardFileName, 'route-smoke-world.worldcard.json');
  assert.equal(exported.card.data.character_book.entries.length, 1);
  assert.equal(Object.keys(exported.worldInfo.entries).length, 1);

  const importResponse = await fetch(`${baseUrl}/api/import-worldbook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: 'route-import.worldinfo.json',
      content: JSON.stringify({
        name: 'Route Import',
        entries: {
          3: {
            uid: 3,
            key: ['route import'],
            comment: 'Route Import Entry',
            content: 'Imported through the route.',
          },
        },
      }),
    }),
  });
  const imported = await importResponse.json();

  assert.equal(importResponse.ok, true);
  assert.equal(imported.importReport.sourceType, 'sillytavern_world_info');
  assert.equal(imported.worldbook.entries[0].title, 'Route Import Entry');
  assert.equal(imported.preview.metrics.entries, 1);

  const augmentResponse = await fetch(`${baseUrl}/api/import-worldbook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'story-augment',
      fileName: 'route-augment.worldinfo.json',
      targetWorldbook: {
        name: 'Route Story',
        entries: [{
          id: 8,
          title: 'Route Existing',
          keys: ['existing'],
          content: 'Existing route story material.',
        }],
      },
      content: JSON.stringify({
        name: 'Route Augment',
        entries: {
          1: {
            uid: 1,
            key: ['augment'],
            comment: 'Route Augment Entry',
            content: 'Augmented route story material.',
          },
        },
      }),
    }),
  });
  const augmented = await augmentResponse.json();

  assert.equal(augmentResponse.ok, true);
  assert.equal(augmented.importReport.mode, 'story-augment');
  assert.equal(augmented.importReport.previousEntryCount, 1);
  assert.equal(augmented.importReport.appendedEntryCount, 1);
  assert.equal(augmented.worldbook.entries.length, 2);
  assert.equal(augmented.worldbook.entries[1].id, 9);
  assert.equal(augmented.card.data.extensions.st_card_writer.deep_role.enabled, true);
});

function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createApiRouter());

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}




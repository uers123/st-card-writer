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

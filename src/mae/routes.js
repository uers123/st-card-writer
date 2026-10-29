import express from 'express';
import { createDefaultMaeRuntime } from './runtime.js';

export function createMaeRouter({ runtime = createDefaultMaeRuntime() } = {}) {
  const router = express.Router();

  router.use((request, response, next) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (request.method === 'OPTIONS') return response.sendStatus(204);
    return next();
  });

  router.get('/health', (_request, response) => response.json({ ok: true, name: 'memory-agency-engine', storage: 'sqlite-or-json-fallback', version: '0.1.0' }));

  router.get('/session', (request, response) => {
    response.json(runtime.snapshot(request.query.chatId || 'default'));
  });

  router.post('/session', asyncHandler(async (request, response) => {
    const chatId = request.body?.chatId || 'default';
    response.json({ ok: true, chatId, snapshot: runtime.snapshot(chatId) });
  }));

  router.post('/settings', asyncHandler(async (request, response) => {
    response.json({ ok: true, settings: runtime.setSettings({ chatId: request.body?.chatId, settings: request.body?.settings }) });
  }));

  router.post('/entity', asyncHandler(async (request, response) => {
    const body = request.body || {};
    response.json({ ok: true, entity: runtime.updateEntity({ chatId: body.chatId, entityId: body.entityId, patch: body.patch }) });
  }));

  router.get('/model-routes', (request, response) => response.json({ ok: true, routes: runtime.getModelRoutes(request.query.chatId || 'default') }));

  router.post('/model-routes', asyncHandler(async (request, response) => {
    response.json({ ok: true, routes: runtime.setModelRoutes({ chatId: request.body?.chatId, defaultApi: request.body?.defaultApi, slots: request.body?.slots }) });
  }));

  router.get('/physiology/rules', (request, response) => response.json({ ok: true, rules: runtime.getPhysiologyRules(runtime.storeFor(request.query.chatId || 'default')) }));

  router.post('/physiology/rules', asyncHandler(async (request, response) => {
    response.json({ ok: true, rules: runtime.setPhysiologyRules({ chatId: request.body?.chatId, rules: request.body?.rules }) });
  }));

  router.post('/physiology/state', asyncHandler(async (request, response) => {
    response.json({ ok: true, state: runtime.setPhysiology({ chatId: request.body?.chatId, entityId: request.body?.entityId, state: request.body?.state }) });
  }));

  router.post('/physiology/contact', asyncHandler(async (request, response) => {
    response.json({ ok: true, result: runtime.settleContact({ chatId: request.body?.chatId, actorIds: request.body?.actorIds, worldTime: request.body?.worldTime }) });
  }));

  router.post('/worldbook/sync', asyncHandler(async (request, response) => {
    const result = runtime.syncWorldbook({ chatId: request.body?.chatId, name: request.body?.name, entries: request.body?.entries || request.body?.worldbook?.entries || [] });
    response.json({ ok: true, worldbook: result, snapshot: runtime.snapshot(request.body?.chatId) });
  }));

  router.post('/turn', asyncHandler(async (request, response) => {
    response.json(await runtime.processTurnAsync(request.body || {}));
  }));

  router.post('/injection', asyncHandler(async (request, response) => {
    const input = request.body || {};
    response.json({ ok: true, injection: runtime.buildInjection({ chatId: input.chatId, turnSeq: input.turnSeq, contextText: input.contextText, settings: input.settings, vectorScores: input.vectorScores }) });
  }));

  router.post('/audit', asyncHandler(async (request, response) => {
    response.json({ ok: true, audit: runtime.auditText(request.body || {}) });
  }));

  router.post('/tick', asyncHandler(async (request, response) => {
    response.json(await runtime.runTick(request.body || {}));
  }));

  router.post('/death', asyncHandler(async (request, response) => {
    response.json({ ok: true, result: runtime.markDeath(request.body || {}) });
  }));

  router.post('/successor', asyncHandler(async (request, response) => {
    response.json({ ok: true, result: runtime.createSuccessor(request.body || {}) });
  }));

  router.get('/gaiden', (request, response) => response.json({ ok: true, chapters: runtime.listGaiden(request.query.chatId || 'default') }));

  router.post('/gaiden/enqueue', asyncHandler(async (request, response) => {
    response.json({ ok: true, entry: runtime.enqueueGaiden(request.body || {}) });
  }));

  router.post('/gaiden/process', asyncHandler(async (request, response) => {
    response.json({ ok: true, result: await runtime.processGaiden(request.body || {}) });
  }));

  router.get('/export', (request, response) => response.json(runtime.snapshot(request.query.chatId || 'default')));

  return router;
}

function asyncHandler(handler) {
  return async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      response.status(400).json({ ok: false, error: error?.message || String(error) });
    }
  };
}
